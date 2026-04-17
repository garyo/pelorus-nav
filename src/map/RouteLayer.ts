/**
 * Renders routes on the map with line segments and waypoint markers.
 * Per-route GeoJSON source with labeled waypoints and leg distances.
 */

import type maplibregl from "maplibre-gl";
import { getAllRoutes } from "../data/db";
import type { Route } from "../data/Route";
import { lightenHex } from "../utils/color";
import { haversineDistanceNM } from "../utils/coordinates";
import { ensurePointIcons, pointRole, ROLE_ICON_EXPR } from "./point-icons";
import {
  GLOW_BLUR,
  GLOW_CIRCLE_BLUR,
  GLOW_CIRCLE_COLOR,
  GLOW_CIRCLE_RADIUS,
  GLOW_LIGHTEN,
  GLOW_OPACITY,
  GLOW_WIDTH,
} from "./selection-glow";

function sourceId(routeId: string): string {
  return `_route-${routeId}`;
}

function lineLayerId(routeId: string): string {
  return `_route-line-${routeId}`;
}

function pointLayerId(routeId: string): string {
  return `_route-points-${routeId}`;
}

function labelLayerId(routeId: string): string {
  return `_route-labels-${routeId}`;
}

/** [minLon, minLat, maxLon, maxLat] or null if route has no waypoints. */
function routeBbox(route: Route): [number, number, number, number] | null {
  const wps = route.waypoints;
  if (wps.length === 0) return null;
  let minLon = wps[0].lon;
  let minLat = wps[0].lat;
  let maxLon = wps[0].lon;
  let maxLat = wps[0].lat;
  for (let i = 1; i < wps.length; i++) {
    const w = wps[i];
    if (w.lon < minLon) minLon = w.lon;
    else if (w.lon > maxLon) maxLon = w.lon;
    if (w.lat < minLat) minLat = w.lat;
    else if (w.lat > maxLat) maxLat = w.lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

export class RouteLayer {
  private readonly map: maplibregl.Map;
  private loadedRoutes = new Map<string, Route>();
  private selectedRouteId: string | null = null;

  constructor(map: maplibregl.Map) {
    this.map = map;
    map.on("style.load", () => this.reloadAll());
    if (map.isStyleLoaded()) this.reloadAll();
  }

  async reloadAll(): Promise<void> {
    for (const [id] of this.loadedRoutes) {
      this.removeRoute(id);
    }
    this.loadedRoutes.clear();

    const routes = await getAllRoutes();
    for (const route of routes) {
      if (route.visible) {
        this.addRoute(route);
      }
      this.loadedRoutes.set(route.id, route);
    }

    // Restore selection halo after style reload
    if (this.selectedRouteId) {
      const sel = this.loadedRoutes.get(this.selectedRouteId);
      if (sel) this.selectRoute(sel);
      else this.selectedRouteId = null;
    }
  }

  async toggleVisibility(id: string, visible: boolean): Promise<void> {
    const route = this.loadedRoutes.get(id);
    if (!route) return;
    route.visible = visible;
    if (visible) {
      this.addRoute(route);
    } else {
      this.removeRoute(id);
    }
  }

  /** Update a route's display (e.g. during editing). */
  updateRoute(route: Route): void {
    this.loadedRoutes.set(route.id, route);
    if (route.visible) {
      this.addRoute(route);
    }
  }

  private addRoute(route: Route): void {
    const sid = sourceId(route.id);
    const data = this.routeGeoJSON(route);

    // Always re-register canvas-drawn icons — they can be lost after
    // setStyle({ diff: true }) even when the source/layers persist.
    ensurePointIcons(this.map);

    if (this.map.getSource(sid)) {
      (this.map.getSource(sid) as maplibregl.GeoJSONSource).setData(data);
      return;
    }

    this.map.addSource(sid, { type: "geojson", data });

    this.map.addLayer({
      id: lineLayerId(route.id),
      type: "line",
      source: sid,
      filter: ["==", "$type", "LineString"],
      paint: {
        "line-color": route.color,
        "line-width": 2.5,
        "line-opacity": 0.9,
      },
    });

    this.map.addLayer({
      id: pointLayerId(route.id),
      type: "symbol",
      source: sid,
      filter: ["==", "$type", "Point"],
      layout: {
        "icon-image": ROLE_ICON_EXPR,
        "icon-size": 0.75,
        "icon-allow-overlap": true,
      },
    });

    this.map.addLayer({
      id: labelLayerId(route.id),
      type: "symbol",
      source: sid,
      filter: ["==", "$type", "Point"],
      layout: {
        "text-field": ["get", "label"],
        "text-size": 11,
        "text-offset": [0, -1.5],
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": "#fff",
        "text-halo-color": "rgba(0,0,0,0.7)",
        "text-halo-width": 1,
      },
    });
  }

  private removeRoute(id: string): void {
    for (const lid of [labelLayerId(id), pointLayerId(id), lineLayerId(id)]) {
      if (this.map.getLayer(lid)) this.map.removeLayer(lid);
    }
    const sid = sourceId(id);
    if (this.map.getSource(sid)) this.map.removeSource(sid);
  }

  // ── Leg highlighting ────────────────────────────────────────────────

  private static readonly HIGHLIGHT_SOURCE = "_route-highlight";
  private static readonly HIGHLIGHT_LINE = "_route-highlight-line";
  private static readonly HIGHLIGHT_POINTS = "_route-highlight-points";

  /** Highlight a single leg (segment between two waypoints). */
  highlightLeg(route: Route, legIndex: number): void {
    const wps = route.waypoints;
    if (legIndex < 0 || legIndex >= wps.length - 1) return;

    const a = wps[legIndex];
    const b = wps[legIndex + 1];
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [a.lon, a.lat],
              [b.lon, b.lat],
            ],
          },
        },
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [a.lon, a.lat] },
        },
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [b.lon, b.lat] },
        },
      ],
    };

    const src = this.map.getSource(RouteLayer.HIGHLIGHT_SOURCE);
    if (src) {
      (src as maplibregl.GeoJSONSource).setData(data);
    } else {
      this.map.addSource(RouteLayer.HIGHLIGHT_SOURCE, {
        type: "geojson",
        data,
      });
      this.map.addLayer({
        id: RouteLayer.HIGHLIGHT_LINE,
        type: "line",
        source: RouteLayer.HIGHLIGHT_SOURCE,
        filter: ["==", "$type", "LineString"],
        paint: {
          "line-color": "#ffcc00",
          "line-width": 5,
          "line-opacity": 0.8,
        },
      });
      this.map.addLayer({
        id: RouteLayer.HIGHLIGHT_POINTS,
        type: "circle",
        source: RouteLayer.HIGHLIGHT_SOURCE,
        filter: ["==", "$type", "Point"],
        paint: {
          "circle-radius": 7,
          "circle-color": "#ffcc00",
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
        },
      });
    }
  }

  /** Remove leg highlight by clearing data (cheaper than remove/re-add). */
  clearHighlight(): void {
    const src = this.map.getSource(RouteLayer.HIGHLIGHT_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (src) {
      src.setData({ type: "FeatureCollection", features: [] });
    }
  }

  /** Ease the map to fit a single leg. */
  fitLeg(route: Route, legIndex: number): void {
    const wps = route.waypoints;
    if (legIndex < 0 || legIndex >= wps.length - 1) return;
    const a = wps[legIndex];
    const b = wps[legIndex + 1];
    this.map.fitBounds(
      [
        [Math.min(a.lon, b.lon), Math.min(a.lat, b.lat)],
        [Math.max(a.lon, b.lon), Math.max(a.lat, b.lat)],
      ],
      { padding: 80, maxZoom: 14, duration: 500 },
    );
  }

  // ── Full-route selection halo ───────────────────────────────────────

  private static readonly SELECTED_SOURCE = "_route-selected-src";
  private static readonly SELECTED_LAYER = "_route-selected-glow";
  private static readonly SELECTED_POINTS_LAYER = "_route-selected-glow-pts";

  /** Draw a soft blur halo around the given route (line + waypoints). */
  selectRoute(route: Route): void {
    this.selectedRouteId = route.id;
    const wps = route.waypoints;
    if (wps.length < 2) {
      this.clearSelectedRoute();
      return;
    }
    const features: GeoJSON.Feature[] = [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: wps.map((w) => [w.lon, w.lat]),
        },
      },
    ];
    for (const w of wps) {
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [w.lon, w.lat] },
      });
    }
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features,
    };

    const glowColor = lightenHex(route.color, GLOW_LIGHTEN);
    const src = this.map.getSource(RouteLayer.SELECTED_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (src) {
      src.setData(data);
      if (this.map.getLayer(RouteLayer.SELECTED_LAYER)) {
        this.map.setPaintProperty(
          RouteLayer.SELECTED_LAYER,
          "line-color",
          glowColor,
        );
      }
      return;
    }

    this.map.addSource(RouteLayer.SELECTED_SOURCE, {
      type: "geojson",
      data,
    });

    const beforeId = this.firstRouteLineLayer();
    this.map.addLayer(
      {
        id: RouteLayer.SELECTED_LAYER,
        type: "line",
        source: RouteLayer.SELECTED_SOURCE,
        filter: ["==", "$type", "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": glowColor,
          "line-width": GLOW_WIDTH,
          "line-blur": GLOW_BLUR,
          "line-opacity": GLOW_OPACITY,
        },
      },
      beforeId,
    );
    this.map.addLayer(
      {
        id: RouteLayer.SELECTED_POINTS_LAYER,
        type: "circle",
        source: RouteLayer.SELECTED_SOURCE,
        filter: ["==", "$type", "Point"],
        paint: {
          "circle-color": GLOW_CIRCLE_COLOR,
          "circle-radius": GLOW_CIRCLE_RADIUS,
          "circle-blur": GLOW_CIRCLE_BLUR,
          "circle-opacity": GLOW_OPACITY,
        },
      },
      beforeId,
    );
  }

  /** Clear the selected-route halo (keeps layer, empties data). */
  clearSelectedRoute(): void {
    this.selectedRouteId = null;
    const src = this.map.getSource(RouteLayer.SELECTED_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (src) {
      src.setData({ type: "FeatureCollection", features: [] });
    }
  }

  /** Zoom to fit the route, but only if it's not already fully visible. */
  fitRoute(route: Route): void {
    const bbox = routeBbox(route);
    if (!bbox) return;
    const b = this.map.getBounds();
    const fullyVisible =
      bbox[0] >= b.getWest() &&
      bbox[2] <= b.getEast() &&
      bbox[1] >= b.getSouth() &&
      bbox[3] <= b.getNorth();
    if (fullyVisible) return;
    this.map.fitBounds(
      [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[3]],
      ],
      { padding: 80, maxZoom: 14, duration: 500 },
    );
  }

  private firstRouteLineLayer(): string | undefined {
    for (const layer of this.map.getStyle().layers) {
      if (layer.id.startsWith("_route-line-")) return layer.id;
    }
    return undefined;
  }

  private routeGeoJSON(route: Route): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];
    const wps = route.waypoints;

    // Line through all waypoints
    if (wps.length >= 2) {
      const coords = wps.map((w) => [w.lon, w.lat]);
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: coords },
      });
    }

    // Waypoint markers with labels
    let totalDist = 0;
    for (let i = 0; i < wps.length; i++) {
      if (i > 0) {
        totalDist += haversineDistanceNM(
          wps[i - 1].lat,
          wps[i - 1].lon,
          wps[i].lat,
          wps[i].lon,
        );
      }
      const label = wps[i].name || `WP${i + 1}`;
      features.push({
        type: "Feature",
        properties: {
          label,
          index: i,
          totalDist: totalDist.toFixed(1),
          role: pointRole(i, wps.length),
        },
        geometry: {
          type: "Point",
          coordinates: [wps[i].lon, wps[i].lat],
        },
      });
    }

    return { type: "FeatureCollection", features };
  }
}
