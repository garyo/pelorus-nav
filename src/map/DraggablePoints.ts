/**
 * Reusable helper for dragging GeoJSON point features on a MapLibre map.
 * Disables map.dragPan during drag and fires a callback with the new position.
 */

import type maplibregl from "maplibre-gl";

export type DragCallback = (
  featureIndex: number,
  lngLat: { lng: number; lat: number },
) => void;

export class DraggablePoints {
  private readonly map: maplibregl.Map;
  private readonly layerId: string;
  private readonly onDrag: DragCallback;

  private dragging = false;
  private dragIndex = -1;
  /** Pixel offset from mousedown to feature anchor, to avoid jump on pickup. */
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  constructor(map: maplibregl.Map, layerId: string, onDrag: DragCallback) {
    this.map = map;
    this.layerId = layerId;
    this.onDrag = onDrag;

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
    canvas.addEventListener("touchmove", this.onTouchMove, { passive: false });
    canvas.addEventListener("touchend", this.onTouchEnd);
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
      // Hover cursor
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
    this.onDrag(this.dragIndex, lngLat);
  }

  private onMouseUp(): void {
    if (!this.dragging) return;
    this.endDrag();
  }

  private onTouchStart(e: TouchEvent): void {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const rect = this.map.getCanvas().getBoundingClientRect();
    const point: [number, number] = [
      touch.clientX - rect.left,
      touch.clientY - rect.top,
    ];
    const features = this.map.queryRenderedFeatures(point, {
      layers: [this.layerId],
    });
    if (features.length === 0) return;
    const feature = features[0];
    if (feature.geometry.type === "Point") {
      const coords = feature.geometry.coordinates;
      const featurePx = this.map.project([coords[0], coords[1]]);
      this.dragOffsetX = featurePx.x - point[0];
      this.dragOffsetY = featurePx.y - point[1];
    }
    e.preventDefault();
    this.startDrag((feature.properties?.index as number) ?? 0);
  }

  private onTouchMove(e: TouchEvent): void {
    if (!this.dragging || e.touches.length !== 1) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = this.map.getCanvas().getBoundingClientRect();
    const lngLat = this.map.unproject([
      touch.clientX - rect.left + this.dragOffsetX,
      touch.clientY - rect.top + this.dragOffsetY,
    ]);
    this.onDrag(this.dragIndex, lngLat);
  }

  private onTouchEnd(): void {
    if (!this.dragging) return;
    this.endDrag();
  }

  private startDrag(index: number): void {
    this.dragging = true;
    this.dragIndex = index;
    this.map.dragPan.disable();
    this.map.getCanvas().style.cursor = "grabbing";
  }

  private endDrag(): void {
    this.dragging = false;
    this.dragIndex = -1;
    this.map.dragPan.enable();
    this.map.getCanvas().style.cursor = "";
  }
}
