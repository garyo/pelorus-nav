/**
 * Shared "soft glow" selection-halo source/layer pair used by RouteLayer and
 * TrackLayer to highlight the currently-selected route/track. Owns only the
 * MapLibre source/layer plumbing — callers compute the glow color and the
 * line (and, for routes, waypoint) coordinates.
 */
import type * as maplibregl from "maplibre-gl";
import {
  GLOW_BLUR,
  GLOW_CIRCLE_BLUR,
  GLOW_CIRCLE_COLOR,
  GLOW_CIRCLE_RADIUS,
  GLOW_OPACITY,
  GLOW_WIDTH,
} from "./selection-glow";

export interface SelectionHaloIds {
  source: string;
  lineLayer: string;
  /** Circle-glow layer for point features (e.g. route waypoints); omit for
   *  halos that only highlight a line (e.g. tracks). */
  pointsLayer?: string;
  /**
   * Glow radius in px (default GLOW_CIRCLE_RADIUS, sized for a route's small
   * waypoint circles). Set it larger to ring a bigger marker — a glow that
   * doesn't reach past the icon it sits under isn't a highlight.
   */
  pointRadius?: number;
}

/** Manages a single glow-halo source + line (+ optional points) layer pair. */
export class SelectionHalo {
  private readonly map: maplibregl.Map;
  private readonly ids: SelectionHaloIds;

  constructor(map: maplibregl.Map, ids: SelectionHaloIds) {
    this.map = map;
    this.ids = ids;
  }

  /**
   * Create or update the halo for the given line coordinates (+ optional
   * point coordinates, e.g. waypoints) and glow color, inserted before
   * `beforeId` when first created.
   */
  update(
    lineCoords: [number, number][],
    color: string,
    beforeId: string | undefined,
    pointCoords?: [number, number][],
  ): void {
    const features: GeoJSON.Feature[] = [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: lineCoords },
      },
    ];
    if (pointCoords) {
      for (const c of pointCoords) {
        features.push({
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: c },
        });
      }
    }
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features,
    };

    // Source and layers are checked separately, not as "have I set this up
    // yet?": a style rebuild can keep the source and drop the layers, and a
    // halo that only re-set its data would then never draw again.
    const src = this.map.getSource(this.ids.source) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (src) {
      src.setData(data);
    } else {
      this.map.addSource(this.ids.source, { type: "geojson", data });
    }

    if (this.map.getLayer(this.ids.lineLayer)) {
      this.map.setPaintProperty(this.ids.lineLayer, "line-color", color);
    } else {
      this.map.addLayer(
        {
          id: this.ids.lineLayer,
          type: "line",
          source: this.ids.source,
          filter: ["==", ["geometry-type"], "LineString"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": color,
            "line-width": GLOW_WIDTH,
            "line-blur": GLOW_BLUR,
            "line-opacity": GLOW_OPACITY,
          },
        },
        beforeId,
      );
    }

    if (this.ids.pointsLayer && !this.map.getLayer(this.ids.pointsLayer)) {
      this.map.addLayer(
        {
          id: this.ids.pointsLayer,
          type: "circle",
          source: this.ids.source,
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-color": GLOW_CIRCLE_COLOR,
            "circle-radius": this.ids.pointRadius ?? GLOW_CIRCLE_RADIUS,
            "circle-blur": GLOW_CIRCLE_BLUR,
            "circle-opacity": GLOW_OPACITY,
          },
        },
        beforeId,
      );
    }
  }

  /**
   * Halo a set of points with no line through them — for standalone points
   * (a grabbed or revealed waypoint) rather than a route's geometry.
   */
  highlightPoints(pointCoords: [number, number][], beforeId?: string): void {
    this.update([], GLOW_CIRCLE_COLOR, beforeId, pointCoords);
  }

  /** Clear the halo (keeps the layer/source, empties the data). */
  clear(): void {
    const src = this.map.getSource(this.ids.source) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (src) {
      src.setData({ type: "FeatureCollection", features: [] });
    }
  }
}
