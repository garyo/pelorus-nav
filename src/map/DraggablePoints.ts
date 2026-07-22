/**
 * Reusable helper for dragging GeoJSON point features on a MapLibre map.
 * Disables map.dragPan during drag and fires a callback with the new position.
 */

import type maplibregl from "maplibre-gl";

export type DragCallback = (
  featureIndex: number,
  lngLat: { lng: number; lat: number },
) => void;

export type TapCallback = (featureIndex: number) => void;

/** Fired once per gesture, just before its first onDrag — i.e. only when
 *  the pointer actually moves. A plain click/tap never fires it. */
export type DragStartCallback = () => void;

/** Fired when a gesture ends (mouse up / touch end), including taps. */
export type DragEndCallback = () => void;

/** Finger-sized half-width for touch hit-testing (px). */
const TOUCH_HIT_SLOP = 10;
/** Movement below this (px) is a tap, not a drag. */
const TAP_MOVE_SLOP = 6;

export class DraggablePoints {
  private readonly map: maplibregl.Map;
  private readonly layerId: string;
  private readonly onDrag: DragCallback;
  private readonly onTap: TapCallback | null;
  private readonly onDragStart: DragStartCallback | null;
  private readonly onDragEnd: DragEndCallback | null;

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

  constructor(
    map: maplibregl.Map,
    layerId: string,
    onDrag: DragCallback,
    onTap: TapCallback | null = null,
    onDragStart: DragStartCallback | null = null,
    onDragEnd: DragEndCallback | null = null,
  ) {
    this.map = map;
    this.layerId = layerId;
    this.onDrag = onDrag;
    this.onTap = onTap;
    this.onDragStart = onDragStart;
    this.onDragEnd = onDragEnd;

    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);

    map.on("mousedown", layerId, this.onMouseDown);
    map.on("mousemove", this.onMouseMove);
    map.on("mouseup", this.onMouseUp);

    const canvas = map.getCanvas();
    canvas.addEventListener("touchstart", this.onTouchStart, {
      passive: false,
    });
    canvas.addEventListener("touchend", this.onTouchEnd);
    // touchmove is attached only while dragging (see startDrag): a
    // permanent non-passive touchmove listener would force the browser
    // to wait on JS before compositing every pan frame.
  }

  destroy(): void {
    this.map.off("mousedown", this.layerId, this.onMouseDown);
    this.map.off("mousemove", this.onMouseMove);
    this.map.off("mouseup", this.onMouseUp);

    const canvas = this.map.getCanvas();
    canvas.removeEventListener("touchstart", this.onTouchStart);
    canvas.removeEventListener("touchmove", this.onTouchMove);
    canvas.removeEventListener("touchend", this.onTouchEnd);
  }

  private onMouseDown(e: maplibregl.MapLayerMouseEvent): void {
    const feature = e.features?.[0];
    if (!feature || feature.geometry.type !== "Point") return;
    e.preventDefault();
    const coords = feature.geometry.coordinates;
    const featurePx = this.map.project([coords[0], coords[1]]);
    this.dragOffsetX = featurePx.x - e.point.x;
    this.dragOffsetY = featurePx.y - e.point.y;
    this.startDrag((feature.properties?.index as number) ?? 0);
  }

  private onMouseMove(e: maplibregl.MapMouseEvent): void {
    if (!this.dragging) {
      // Hover cursor. The layer can be briefly absent mid style-rebuild
      // (refreshStyle re-adds overlays async) — querying then throws.
      if (!this.map.getLayer(this.layerId)) return;
      const features = this.map.queryRenderedFeatures(e.point, {
        layers: [this.layerId],
      });
      this.map.getCanvas().style.cursor = features.length > 0 ? "grab" : "";
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
    if (e.touches.length !== 1) return;
    // Same guard as onMouseMove: the layer can be briefly absent
    // mid style-rebuild — querying then throws.
    if (!this.map.getLayer(this.layerId)) return;
    const touch = e.touches[0];
    const rect = this.map.getCanvas().getBoundingClientRect();
    const point: [number, number] = [
      touch.clientX - rect.left,
      touch.clientY - rect.top,
    ];
    // Fingers are imprecise — hit-test a small box, not the exact pixel.
    const features = this.map.queryRenderedFeatures(
      [
        [point[0] - TOUCH_HIT_SLOP, point[1] - TOUCH_HIT_SLOP],
        [point[0] + TOUCH_HIT_SLOP, point[1] + TOUCH_HIT_SLOP],
      ],
      { layers: [this.layerId] },
    );
    if (features.length === 0) return;
    const feature = features[0];
    if (feature.geometry.type === "Point") {
      const coords = feature.geometry.coordinates;
      const featurePx = this.map.project([coords[0], coords[1]]);
      this.dragOffsetX = featurePx.x - point[0];
      this.dragOffsetY = featurePx.y - point[1];
    }
    // preventDefault also suppresses the synthetic click, so tap
    // handling is ours to do: see onTouchEnd.
    e.preventDefault();
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
    this.touchMoved = false;
    this.startDrag((feature.properties?.index as number) ?? 0);
  }

  private onTouchMove(e: TouchEvent): void {
    if (!this.dragging || e.touches.length !== 1) return;
    e.preventDefault();
    const touch = e.touches[0];
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
    this.onDragStart?.();
  }

  private onTouchEnd(): void {
    if (!this.dragging) return;
    const wasTap = !this.touchMoved;
    const index = this.dragIndex;
    this.endDrag();
    if (wasTap) this.onTap?.(index);
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
    this.map.dragPan.enable();
    const canvas = this.map.getCanvas();
    canvas.removeEventListener("touchmove", this.onTouchMove);
    canvas.style.cursor = "";
    this.onDragEnd?.();
  }
}
