/**
 * Reusable helper for dragging GeoJSON point features on a MapLibre map.
 * Disables map.dragPan during drag and fires a callback with the new position.
 *
 * Hit-testing has two modes. By default the layer's rendered symbols are
 * queried. Pass `getPoints` and handles are located by projecting those
 * coordinates instead (see point-hit-test) — exact regardless of how far
 * MapLibre's symbol placement lags the camera, which is what makes edit taps
 * reliable right after a pan.
 */

import type maplibregl from "maplibre-gl";
import { type GeoPoint, nearestPointIndex } from "./point-hit-test";

export type DragCallback = (
  featureIndex: number,
  lngLat: { lng: number; lat: number },
) => void;

export type TapCallback = (featureIndex: number) => void;

/**
 * Fired once per gesture, just before its first onDrag — i.e. only when the
 * pointer actually moves. A plain click/tap never fires it.
 *
 * Receives the index being dragged and may return a different one to drag
 * instead, which lets a caller turn a placeholder handle into a real point
 * at the moment the drag starts and carry the gesture over to it.
 */
export type DragStartCallback = (index: number) => number | void;

/** Fired when a gesture ends (mouse up / touch end), including taps. */
export type DragEndCallback = () => void;

/** Finger-sized half-width for touch hit-testing (px). */
const TOUCH_HIT_SLOP = 10;
/** Movement below this (px) is a tap, not a drag. */
const TAP_MOVE_SLOP = 6;
/** Default reach of the geometric hit test (px). */
const DEFAULT_HIT_RADIUS = 22;

export interface DraggablePointsOptions {
  /** Handle positions, ordered to match each feature's `index` property.
   *  Supplying this switches hit-testing from rendered-symbol queries to
   *  geometry. */
  getPoints: () => readonly GeoPoint[];
  /** Reach of the geometric hit test in px (default 22 — an icon half-width
   *  plus finger slop). */
  hitRadius?: number;
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

  private dragging = false;
  private dragIndex = -1;
  /** True once this gesture has produced an onDrag (gates onDragStart). */
  private movedThisGesture = false;
  /** Pixel offset from mousedown to feature anchor, to avoid jump on pickup. */
  private dragOffsetX = 0;
  private dragOffsetY = 0;
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

    this.onMouseDown = this.onMouseDown.bind(this);
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

  destroy(): void {
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

  private onMouseDown(e: maplibregl.MapMouseEvent): void {
    const hit = this.hitTest(e.point.x, e.point.y);
    if (!hit) return;
    e.preventDefault();
    this.setGrabOffset(hit, e.point.x, e.point.y);
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
    const lngLat = this.map.unproject([
      e.point.x + this.dragOffsetX,
      e.point.y + this.dragOffsetY,
    ]);
    this.noteGestureMoved();
    this.onDrag(this.dragIndex, lngLat);
  }

  private onMouseUp(): void {
    if (!this.dragging) return;
    this.endDrag();
  }

  private onTouchStart(e: TouchEvent): void {
    // Only start on the first finger; a second finger landing mid-drag must
    // not restart or hijack the gesture.
    if (this.dragging || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const rect = this.map.getCanvas().getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    const hit = this.hitTest(x, y);
    if (!hit) return;
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
    this.noteGestureMoved();
    this.onDrag(this.dragIndex, lngLat);
  }

  private noteGestureMoved(): void {
    if (this.movedThisGesture) return;
    this.movedThisGesture = true;
    const replacement = this.onDragStart?.(this.dragIndex);
    if (typeof replacement === "number") this.dragIndex = replacement;
  }

  private onTouchEnd(e: TouchEvent): void {
    // Only the drag's own finger lifting ends it — another finger's touchend
    // must be ignored, or a two-finger interaction terminates the drag early.
    if (!this.dragging || !this.dragTouch(e.changedTouches)) return;
    const wasTap = !this.touchMoved;
    const index = this.dragIndex;
    this.endDrag();
    if (wasTap) this.onTap?.(index);
  }

  private onTouchCancel(e: TouchEvent): void {
    if (!this.dragging || !this.dragTouch(e.changedTouches)) return;
    // Interrupted, not completed: end the drag but fire no tap.
    this.endDrag();
  }

  private startDrag(index: number): void {
    this.dragging = true;
    this.dragIndex = index;
    this.movedThisGesture = false;
    this.map.dragPan.disable();
    const canvas = this.map.getCanvas();
    canvas.addEventListener("touchmove", this.onTouchMove, { passive: false });
    canvas.style.cursor = "grabbing";
  }

  private endDrag(): void {
    this.dragging = false;
    this.dragIndex = -1;
    this.dragTouchId = null;
    this.map.dragPan.enable();
    const canvas = this.map.getCanvas();
    canvas.removeEventListener("touchmove", this.onTouchMove);
    canvas.style.cursor = "";
    this.onDragEnd?.();
  }
}
