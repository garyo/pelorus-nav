/**
 * Renders routes on the map with line segments and waypoint markers.
 * Per-route GeoJSON source with labeled waypoints and leg distances.
 */

import type maplibregl from "maplibre-gl";
import { getAllRoutes } from "../data/db";
import type { Route } from "../data/Route";
import { haversineDistanceNM } from "../utils/coordinates";
import { ensurePointIcons, pointRole, ROLE_ICON_EXPR } from "./point-icons";

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

export class RouteLayer {
  private readonly map: maplibregl.Map;
  private loadedRoutes = new Map<string, Route>();

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

    ensurePointIcons(this.map);
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

  /** Remove leg highlight. */
  clearHighlight(): void {
    for (const lid of [
      RouteLayer.HIGHLIGHT_POINTS,
      RouteLayer.HIGHLIGHT_LINE,
    ]) {
      if (this.map.getLayer(lid)) this.map.removeLayer(lid);
    }
    if (this.map.getSource(RouteLayer.HIGHLIGHT_SOURCE)) {
      this.map.removeSource(RouteLayer.HIGHLIGHT_SOURCE);
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
