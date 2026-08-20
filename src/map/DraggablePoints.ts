/**
 * Reusable helper for dragging GeoJSON point features on a MapLibre map.
 * Disables map.dragPan during drag and fires a callback with the new position.
 *
 * Hit-testing has two modes. By default the layer's rendered symbols are
 * queried. Pass `getPoints` and handles are located by projecting those
 * coordinates instead (see point-hit-test) — exact regardless of how far
 * MapLibre's symbol placement lags the camera, which is what makes edit taps
 * reliable right after a pan.
 *
 * Grabbing has two modes too. By default a press on a handle picks it up
 * immediately, which is what a dedicated editing mode wants. Pass `holdMs` and
 * the handle is picked up only after the press has been held still that long —
 * for handles that live on the ordinary chart, where every pan starts on top of
 * something and an immediate grab silently moves the user's data.
 */

import type * as maplibregl from "maplibre-gl";
import { type GeoPoint, nearestPointIndex } from "./point-hit-test";
import { claimMapPress, releaseMapPress } from "./press-claim";

export type DragCallback = (
  featureIndex: number,
  lngLat: { lng: number; lat: number },
) => void;

export type TapCallback = (featureIndex: number) => void;

/**
 * Fired once per gesture, just before its first onDrag — i.e. only when the
 * pointer actually moves past the tap slop. A plain click/tap never fires it.
 *
 * Receives the index being dragged and may return a different one to drag
 * instead, which lets a caller turn a placeholder handle into a real point at
 * the moment the drag starts and carry the gesture over to it. The callback
 * may mutate the array `getPoints()` returns (e.g. insert the new point), and
 * the returned replacement index is interpreted against that *post-callback*
 * array — subsequent onDrag calls index into it.
 */
/** Return a number to hand the gesture to a different index (ghost →
 *  freshly inserted point), `false` to reject the drag entirely (the
 *  gesture ends; nothing moves), or void to proceed as-is. */
export type DragStartCallback = (index: number) => number | void | false;

/** Fired when a gesture ends (mouse up / touch end), including taps. */
export type DragEndCallback = () => void;

/** Finger-sized half-width for touch hit-testing (px). */
const TOUCH_HIT_SLOP = 10;
/** Movement below this (px) is a tap, not a drag. */
const TAP_MOVE_SLOP = 6;
/** Movement above this (px) during a hold means the user is panning, not
 *  reaching for a handle — the hold is abandoned. Looser than the tap slop:
 *  a press held on a boat underway is never perfectly still. */
const HOLD_MOVE_SLOP = 10;
/** Default reach of the geometric hit test (px). */
const DEFAULT_HIT_RADIUS = 22;

export interface DraggablePointsOptions {
  /** Handle positions, ordered to match each feature's `index` property.
   *  Supplying this switches hit-testing from rendered-symbol queries to
   *  geometry. */
  getPoints?: () => readonly GeoPoint[];
  /** Reach of the geometric hit test in px (default 22 — an icon half-width
   *  plus finger slop). */
  hitRadius?: number;
  /**
   * Hold the press this long (ms) before a handle is picked up. 0 (the
   * default) picks it up on contact.
   *
   * Must stay below the map's own long-press interval so this hold arms
   * first and claims the press (see press-claim.ts), or a hold on a handle
   * would also open the chart's context menu.
   */
  holdMs?: number;
  /** The hold armed and the handle is now live — for the cue that tells the
   *  user they have picked something up. Never fires when `holdMs` is 0. */
  onGrab?: (index: number) => void;
  /**
   * Queried when a hold is about to arm (canvas-relative press point).
   * Returning false abandons the hold without claiming the press — the
   * map's own long-press then fires instead. Lets a waypoint decline its
   * direct grab when a route point shares the spot, so the targeted menu
   * can disambiguate (see docs/gesture-model.md).
   */
  canGrab?: (index: number, x: number, y: number) => boolean;
}

/** A handle under the pointer: its feature index and, when known, the
 *  anchor to measure the grab offset from. */
interface Hit {
  index: number;
  anchor: [number, number] | null;
}

export class DraggablePoints {
  private readonly map: maplibregl.Map;
  private readonly layerId: string;
  private readonly onDrag: DragCallback;
  private readonly onTap: TapCallback | null;
  private readonly onDragStart: DragStartCallback | null;
  private readonly onDragEnd: DragEndCallback | null;
  private readonly getPoints: (() => readonly GeoPoint[]) | null;
  private readonly hitRadius: number;
  private readonly holdMs: number;
  private readonly onGrab: ((index: number) => void) | null;
  private readonly canGrab:
    | ((index: number, x: number, y: number) => boolean)
    | null;

  /** Pending hold: the press that may yet become a grab. Null whenever no
   *  hold is in flight, which is always the case when holdMs is 0. */
  private hold: {
    timer: ReturnType<typeof setTimeout>;
    hit: Hit;
    /** Canvas-relative press point, to arm from once the timer fires. */
    x: number;
    y: number;
    /** Press point in client coords — what movement is measured against. */
    clientX: number;
    clientY: number;
    /** The finger's identifier, or null for a mouse press. */
    touchId: number | null;
  } | null = null;

  private dragging = false;
  private dragIndex = -1;
  /** True once this gesture has produced an onDrag (gates onDragStart). */
  private movedThisGesture = false;
  /** Pixel offset from mousedown to feature anchor, to avoid jump on pickup. */
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  /** Mouse-down point and moved-past-slop flag, for tap-vs-drag on mouse. */
  private mouseDownX = 0;
  private mouseDownY = 0;
  private mouseMoved = false;
  /** Touch-down point, for tap-vs-drag discrimination. */
  private touchStartX = 0;
  private touchStartY = 0;
  private touchMoved = false;
  /** Identifier of the finger that owns the current drag, so a second
   *  finger touching or lifting elsewhere can't hijack or end it. */
  private dragTouchId: number | null = null;

  constructor(
    map: maplibregl.Map,
    layerId: string,
    onDrag: DragCallback,
    onTap: TapCallback | null = null,
    onDragStart: DragStartCallback | null = null,
    onDragEnd: DragEndCallback | null = null,
    options?: DraggablePointsOptions,
  ) {
    this.map = map;
    this.layerId = layerId;
    this.onDrag = onDrag;
    this.onTap = onTap;
    this.onDragStart = onDragStart;
    this.onDragEnd = onDragEnd;
    this.getPoints = options?.getPoints ?? null;
    this.hitRadius = options?.hitRadius ?? DEFAULT_HIT_RADIUS;
    this.holdMs = options?.holdMs ?? 0;
    this.onGrab = options?.onGrab ?? null;
    this.canGrab = options?.canGrab ?? null;

    this.onMouseDown = this.onMouseDown.bind(this);
    this.onHoldMouseMove = this.onHoldMouseMove.bind(this);
    this.onHoldTouchMove = this.onHoldTouchMove.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);
    this.onTouchCancel = this.onTouchCancel.bind(this);

    // Bound to the map, not the layer: with a geometric hit test there is no
    // layer query to hang the handler off, and the query path applies the
    // same finger slop the touch path always has.
    map.on("mousedown", this.onMouseDown);
    map.on("mousemove", this.onMouseMove);
    // mouseup on window, not the map: a release outside the canvas (drag ran
    // off the edge) must still end the drag, or dragPan stays disabled.
    window.addEventListener("mouseup", this.onMouseUp);

    const canvas = map.getCanvas();
    canvas.addEventListener("touchstart", this.onTouchStart, {
      passive: false,
    });
    canvas.addEventListener("touchend", this.onTouchEnd);
    // touchcancel is not touchend: a system interruption (incoming call,
    // edge-gesture, palm rejection — routine on a marine tablet) fires it
    // instead, and without a handler the drag never ends and the map can't
    // be panned for the rest of the session.
    canvas.addEventListener("touchcancel", this.onTouchCancel);
    // touchmove is attached only while dragging (see startDrag): a
    // permanent non-passive touchmove listener would force the browser
    // to wait on JS before compositing every pan frame.
  }

  /** True between a gesture's grab and its release (mouse or touch). */
  isDragging(): boolean {
    return this.dragging;
  }

  destroy(): void {
    // A pending hold would otherwise arm after teardown, on a map this
    // instance no longer owns.
    this.cancelHold();
    // A live gesture (finger still down while the owner tears us down) would
    // otherwise leave dragPan disabled and the cursor stuck.
    if (this.dragging) this.endDrag();
    this.map.off("mousedown", this.onMouseDown);
    this.map.off("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);

    const canvas = this.map.getCanvas();
    canvas.removeEventListener("touchstart", this.onTouchStart);
    canvas.removeEventListener("touchmove", this.onTouchMove);
    canvas.removeEventListener("touchend", this.onTouchEnd);
    canvas.removeEventListener("touchcancel", this.onTouchCancel);
  }

  /** Locate a handle at a canvas-relative pixel, by geometry when the caller
   *  supplied positions, otherwise by querying the rendered symbols. */
  private hitTest(x: number, y: number): Hit | null {
    const points = this.getPoints?.();
    if (points) {
      const index = nearestPointIndex(
        points,
        { x, y },
        (lonLat) => this.map.project(lonLat),
        this.hitRadius,
      );
      if (index === null) return null;
      return { index, anchor: [points[index].lon, points[index].lat] };
    }

    // The layer can be briefly absent mid style-rebuild (refreshStyle re-adds
    // overlays async) — querying then throws.
    if (!this.map.getLayer(this.layerId)) return null;
    const features = this.map.queryRenderedFeatures(
      [
        [x - TOUCH_HIT_SLOP, y - TOUCH_HIT_SLOP],
        [x + TOUCH_HIT_SLOP, y + TOUCH_HIT_SLOP],
      ],
      { layers: [this.layerId] },
    );
    const feature = features[0];
    if (!feature) return null;
    const index = (feature.properties?.index as number) ?? 0;
    if (feature.geometry.type !== "Point") return { index, anchor: null };
    const coords = feature.geometry.coordinates;
    return { index, anchor: [coords[0], coords[1]] };
  }

  /** Record where the grab landed relative to the handle's anchor, so the
   *  point doesn't jump under the cursor on pickup. */
  private setGrabOffset(hit: Hit, x: number, y: number): void {
    if (!hit.anchor) {
      this.dragOffsetX = 0;
      this.dragOffsetY = 0;
      return;
    }
    const anchorPx = this.map.project(hit.anchor);
    this.dragOffsetX = anchorPx.x - x;
    this.dragOffsetY = anchorPx.y - y;
  }

  // ── Press-and-hold arming ───────────────────────────────────────────
  //
  // While a hold is pending the press is left entirely alone: not
  // preventDefault-ed, dragPan still enabled. So a press that turns out to be
  // a pan pans from its first pixel, and one that turns out to be a tap still
  // produces the click the rest of the app listens for. Only when the hold
  // arms do we take the gesture over.

  /** Begin the hold for a press on `hit`. */
  private beginHold(
    hit: Hit,
    x: number,
    y: number,
    client: { x: number; y: number },
    touchId: number | null,
  ): void {
    this.cancelHold();
    this.hold = {
      timer: setTimeout(() => this.armHold(), this.holdMs),
      hit,
      x,
      y,
      clientX: client.x,
      clientY: client.y,
      touchId,
    };
    // Raw DOM events, not the map's: MapLibre stops firing its own mousemove
    // once a drag gesture engages, so a hold watching those would never see
    // the pan it is supposed to stand down for. Window, not canvas, so a
    // pointer that leaves the map still cancels.
    if (touchId === null) {
      window.addEventListener("mousemove", this.onHoldMouseMove, true);
    } else {
      this.map
        .getCanvas()
        .addEventListener("touchmove", this.onHoldTouchMove, { passive: true });
    }
  }

  private cancelHold(): void {
    if (!this.hold) return;
    clearTimeout(this.hold.timer);
    this.map.getCanvas().removeEventListener("touchmove", this.onHoldTouchMove);
    window.removeEventListener("mousemove", this.onHoldMouseMove, true);
    this.hold = null;
  }

  /** The hold survived: take the gesture over and pick the handle up. */
  private armHold(): void {
    const hold = this.hold;
    if (!hold) return;
    this.cancelHold();
    if (this.canGrab && !this.canGrab(hold.hit.index, hold.x, hold.y)) return;

    this.setGrabOffset(hold.hit, hold.x, hold.y);
    if (hold.touchId !== null) {
      this.dragTouchId = hold.touchId;
      this.touchStartX = hold.clientX;
      this.touchStartY = hold.clientY;
      this.touchMoved = false;
    } else {
      this.mouseDownX = hold.x;
      this.mouseDownY = hold.y;
      this.mouseMoved = false;
    }
    // The map's own long-press must not also fire on this press.
    claimMapPress();
    this.startDrag(hold.hit.index);
    this.onGrab?.(hold.hit.index);
  }

  /** Movement past the slop means this press is a pan — let the map have it. */
  private movedPastHoldSlop(clientX: number, clientY: number): boolean {
    if (!this.hold) return false;
    const dx = clientX - this.hold.clientX;
    const dy = clientY - this.hold.clientY;
    return dx * dx + dy * dy > HOLD_MOVE_SLOP * HOLD_MOVE_SLOP;
  }

  private onHoldMouseMove(e: MouseEvent): void {
    if (this.movedPastHoldSlop(e.clientX, e.clientY)) this.cancelHold();
  }

  private onHoldTouchMove(e: TouchEvent): void {
    if (!this.hold) return;
    // A second finger (pinch) is never the start of a drag.
    if (e.touches.length !== 1) {
      this.cancelHold();
      return;
    }
    const touch = e.touches[0];
    if (this.movedPastHoldSlop(touch.clientX, touch.clientY)) this.cancelHold();
  }

  private onMouseDown(e: maplibregl.MapMouseEvent): void {
    const hit = this.hitTest(e.point.x, e.point.y);
    if (!hit) return;
    if (this.holdMs > 0) {
      const src = e.originalEvent;
      this.beginHold(
        hit,
        e.point.x,
        e.point.y,
        { x: src.clientX, y: src.clientY },
        null,
      );
      return;
    }
    e.preventDefault();
    this.setGrabOffset(hit, e.point.x, e.point.y);
    this.mouseDownX = e.point.x;
    this.mouseDownY = e.point.y;
    this.mouseMoved = false;
    this.startDrag(hit.index);
  }

  private onMouseMove(e: maplibregl.MapMouseEvent): void {
    if (!this.dragging) {
      // Hover cursor.
      const hit = this.hitTest(e.point.x, e.point.y);
      this.map.getCanvas().style.cursor = hit ? "grab" : "";
      return;
    }
    e.preventDefault();
    if (!this.mouseMoved) {
      // Below-slop jitter is a click, not a drag — treating it as a drag both
      // nudges the point and, since it's under the browser's click tolerance,
      // still emits a click that toggles selection. Wait for real movement so
      // onDragStart (checkpoint / ghost-insert) doesn't fire on a stray tap.
      const dx = e.point.x - this.mouseDownX;
      const dy = e.point.y - this.mouseDownY;
      if (dx * dx + dy * dy < TAP_MOVE_SLOP * TAP_MOVE_SLOP) return;
      this.mouseMoved = true;
    }
    const lngLat = this.map.unproject([
      e.point.x + this.dragOffsetX,
      e.point.y + this.dragOffsetY,
    ]);
    if (!this.noteGestureMoved()) return;
    this.onDrag(this.dragIndex, lngLat);
  }

  private onMouseUp(): void {
    this.cancelHold();
    if (!this.dragging) return;
    this.endDrag();
  }

  private onTouchStart(e: TouchEvent): void {
    // Only start on the first finger; a second finger landing mid-drag must
    // not restart or hijack the gesture.
    if (this.dragging || e.touches.length !== 1) {
      this.cancelHold();
      return;
    }
    const touch = e.touches[0];
    const rect = this.map.getCanvas().getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    const hit = this.hitTest(x, y);
    if (!hit) return;
    if (this.holdMs > 0) {
      this.beginHold(
        hit,
        x,
        y,
        { x: touch.clientX, y: touch.clientY },
        touch.identifier,
      );
      return;
    }
    this.setGrabOffset(hit, x, y);
    // preventDefault also suppresses the synthetic click, so tap
    // handling is ours to do: see onTouchEnd.
    e.preventDefault();
    this.dragTouchId = touch.identifier;
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
    this.touchMoved = false;
    this.startDrag(hit.index);
  }

  /** The finger owning the drag within a TouchList, or null if it's absent. */
  private dragTouch(list: TouchList): Touch | null {
    for (let i = 0; i < list.length; i++) {
      if (list[i].identifier === this.dragTouchId) return list[i];
    }
    return null;
  }

  private onTouchMove(e: TouchEvent): void {
    if (!this.dragging) return;
    const touch = this.dragTouch(e.touches);
    if (!touch) return;
    e.preventDefault();
    if (!this.touchMoved) {
      const dx = touch.clientX - this.touchStartX;
      const dy = touch.clientY - this.touchStartY;
      // Ignore sub-slop jitter so a slightly shaky tap stays a tap.
      if (dx * dx + dy * dy < TAP_MOVE_SLOP * TAP_MOVE_SLOP) return;
      this.touchMoved = true;
    }
    const rect = this.map.getCanvas().getBoundingClientRect();
    const lngLat = this.map.unproject([
      touch.clientX - rect.left + this.dragOffsetX,
      touch.clientY - rect.top + this.dragOffsetY,
    ]);
    if (!this.noteGestureMoved()) return;
    this.onDrag(this.dragIndex, lngLat);
  }

  /** Returns false when the drag was rejected by onDragStart (gesture ends,
   *  the pending onDrag must not fire). */
  private noteGestureMoved(): boolean {
    if (this.movedThisGesture) return this.dragging;
    this.movedThisGesture = true;
    const replacement = this.onDragStart?.(this.dragIndex);
    if (replacement === false) {
      this.endDrag();
      return false;
    }
    if (typeof replacement === "number") this.dragIndex = replacement;
    return true;
  }

  private onTouchEnd(e: TouchEvent): void {
    // A lift before the hold armed is a tap: abandon the hold and leave the
    // press to the click handlers, which never saw it suppressed.
    this.cancelHold();
    // Only the drag's own finger lifting ends it — another finger's touchend
    // must be ignored, or a two-finger interaction terminates the drag early.
    if (!this.dragging || !this.dragTouch(e.changedTouches)) return;
    const wasTap = !this.touchMoved;
    const index = this.dragIndex;
    this.endDrag();
    if (wasTap) this.onTap?.(index);
  }

  private onTouchCancel(e: TouchEvent): void {
    this.cancelHold();
    if (!this.dragging || !this.dragTouch(e.changedTouches)) return;
    // Interrupted, not completed: end the drag but fire no tap.
    this.endDrag();
  }

  private startDrag(index: number): void {
    this.dragging = true;
    this.dragIndex = index;
    this.movedThisGesture = false;
    // Every engaged drag owns its press — a motionless hold on a grabbed
    // handle must not also fire the chart's long-press menu. (endDrag
    // releases; armHold's claim for held grabs is the same call, idempotent.)
    claimMapPress();
    this.map.dragPan.disable();
    const canvas = this.map.getCanvas();
    canvas.addEventListener("touchmove", this.onTouchMove, { passive: false });
    canvas.style.cursor = "grabbing";
  }

  private endDrag(): void {
    this.dragging = false;
    this.dragIndex = -1;
    this.dragTouchId = null;
    releaseMapPress();
    this.map.dragPan.enable();
    const canvas = this.map.getCanvas();
    canvas.removeEventListener("touchmove", this.onTouchMove);
    canvas.style.cursor = "";
    this.onDragEnd?.();
  }
}
