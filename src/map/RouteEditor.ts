/**
 * Interactive route editor. Click to add waypoints, drag to reposition.
 * Shows per-leg distance/bearing and running total.
 * Preview line follows cursor from last waypoint.
 */

import type maplibregl from "maplibre-gl";
import { saveRoute } from "../data/db";
import type { Route, Waypoint } from "../data/Route";
import { haversineDistanceNM, initialBearingDeg } from "../utils/coordinates";
import { DraggablePoints } from "./DraggablePoints";
import { getMode, setMode } from "./InteractionMode";
import { ensurePointIcons, ROLE_ICON_EXPR } from "./point-icons";
import type { RouteLayer } from "./RouteLayer";

const SOURCE_ID = "_route-edit-points";
const LAYER_POINTS = "_route-edit-points";
const SOURCE_LINE = "_route-edit-line";
const LAYER_LINE = "_route-edit-line";
const SOURCE_PREVIEW = "_route-edit-preview";
const LAYER_PREVIEW = "_route-edit-preview";

type EditorListener = () => void;

export class RouteEditor {
  private readonly map: maplibregl.Map;
  private readonly routeLayer: RouteLayer;
  private route: Route | null = null;
  private editingExistingId: string | null = null;
  private draggable: DraggablePoints | null = null;
  private clickHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private moveHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private bar: HTMLDivElement;
  private barText: HTMLDivElement;
  private listeners: EditorListener[] = [];

  constructor(map: maplibregl.Map, routeLayer: RouteLayer) {
    this.map = map;
    this.routeLayer = routeLayer;

    this.bar = document.createElement("div");
    this.bar.className = "route-editor-bar";
    this.bar.style.display = "none";
    this.bar.innerHTML =
      '<div class="route-editor-text"></div>' +
      '<button class="route-editor-btn">Done</button>' +
      '<button class="route-editor-btn route-editor-btn--cancel">Cancel</button>';
    document.body.appendChild(this.bar);

    this.barText = this.bar.querySelector(
      ".route-editor-text",
    ) as HTMLDivElement;
    this.bar
      .querySelector(".route-editor-btn:not(.route-editor-btn--cancel)")
      ?.addEventListener("click", () => this.finish());
    this.bar
      .querySelector(".route-editor-btn--cancel")
      ?.addEventListener("click", () => this.cancel());

    map.on("style.load", () => this.setupLayers());
    if (map.isStyleLoaded()) this.setupLayers();
  }

  isEditing(): boolean {
    return this.route !== null;
  }

  onEditorChange(fn: EditorListener): void {
    this.listeners.push(fn);
  }

  /** Start a new route with the first waypoint at the given position. */
  startFromPoint(lat: number, lon: number): void {
    this.startEditing({
      id: crypto.randomUUID(),
      name: `Route ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      createdAt: Date.now(),
      color: "#4488cc",
      visible: true,
      waypoints: [{ lat, lon, name: "WP1" }],
    });
  }

  /** Start editing a new or existing route. */
  startEditing(route?: Route): void {
    // Hide the existing route display while editing
    this.editingExistingId = route?.id ?? null;
    if (this.editingExistingId) {
      this.routeLayer.toggleVisibility(this.editingExistingId, false);
    }

    this.route = route ?? {
      id: crypto.randomUUID(),
      name: `Route ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      createdAt: Date.now(),
      color: "#4488cc",
      visible: true,
      waypoints: [],
    };

    setMode("route-edit");
    this.bar.style.display = "flex";
    this.updateBar();
    this.updateSources();
    this.setupDrag();

    this.clickHandler = (e: maplibregl.MapMouseEvent) => {
      if (getMode() !== "route-edit" || !this.route) return;

      // Don't add waypoint if clicking on existing point (that's a drag)
      const features = this.map.queryRenderedFeatures(e.point, {
        layers: [LAYER_POINTS],
      });
      if (features.length > 0) return;

      const wp: Waypoint = {
        lat: e.lngLat.lat,
        lon: e.lngLat.lng,
        name: `WP${this.route.waypoints.length + 1}`,
      };
      this.route.waypoints.push(wp);
      this.updateSources();
      this.updateBar();
      this.setupDrag();
    };
    this.map.on("click", this.clickHandler);

    this.moveHandler = (e: maplibregl.MapMouseEvent) => {
      this.updatePreview(e.lngLat);
    };
    this.map.on("mousemove", this.moveHandler);

    this.notify();
  }

  /** Save and exit editor. */
  async finish(): Promise<void> {
    if (!this.route) return;
    await saveRoute(this.route);
    this.routeLayer.updateRoute(this.route);
    this.cleanup();
    await this.routeLayer.reloadAll();
    this.notify();
  }

  /** Cancel without saving. */
  cancel(): void {
    this.cleanup();
    this.notify();
  }

  private cleanup(): void {
    // Restore the original route display
    if (this.editingExistingId) {
      this.routeLayer.toggleVisibility(this.editingExistingId, true);
      this.editingExistingId = null;
    }

    if (this.clickHandler) {
      this.map.off("click", this.clickHandler);
      this.clickHandler = null;
    }
    if (this.moveHandler) {
      this.map.off("mousemove", this.moveHandler);
      this.moveHandler = null;
    }
    if (this.draggable) {
      this.draggable.destroy();
      this.draggable = null;
    }
    this.route = null;
    this.bar.style.display = "none";
    this.clearSources();
    if (getMode() === "route-edit") {
      setMode("query");
    }
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private setupLayers(): void {
    if (this.map.getSource(SOURCE_LINE)) return;

    this.map.addSource(SOURCE_LINE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    this.map.addSource(SOURCE_PREVIEW, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    this.map.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    this.map.addLayer({
      id: LAYER_LINE,
      type: "line",
      source: SOURCE_LINE,
      paint: {
        "line-color": "#4488cc",
        "line-width": 2.5,
      },
    });

    this.map.addLayer({
      id: LAYER_PREVIEW,
      type: "line",
      source: SOURCE_PREVIEW,
      paint: {
        "line-color": "#4488cc",
        "line-width": 2,
        "line-opacity": 0.5,
        "line-dasharray": [4, 3],
      },
    });

    ensurePointIcons(this.map);
    this.map.addLayer({
      id: LAYER_POINTS,
      type: "symbol",
      source: SOURCE_ID,
      layout: {
        "icon-image": ROLE_ICON_EXPR,
        "icon-size": 1,
        "icon-allow-overlap": true,
      },
    });
  }

  private setupDrag(): void {
    if (this.draggable) this.draggable.destroy();
    this.draggable = new DraggablePoints(
      this.map,
      LAYER_POINTS,
      (index, lngLat) => {
        if (!this.route) return;
        const wp = this.route.waypoints[index];
        if (!wp) return;
        wp.lat = lngLat.lat;
        wp.lon = lngLat.lng;
        this.updateSources();
        this.updateBar();
      },
    );
  }

  private updateSources(): void {
    if (!this.route) return;
    const wps = this.route.waypoints;

    const ptSrc = this.map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    const lineSrc = this.map.getSource(SOURCE_LINE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!ptSrc || !lineSrc) return;

    const points: GeoJSON.Feature[] = wps.map((wp, i) => ({
      type: "Feature",
      properties: {
        index: i,
        label: wp.name || `WP${i + 1}`,
        role: pointRole(i, wps.length),
      },
      geometry: { type: "Point", coordinates: [wp.lon, wp.lat] },
    }));
    ptSrc.setData({ type: "FeatureCollection", features: points });

    if (wps.length >= 2) {
      lineSrc.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: wps.map((w) => [w.lon, w.lat]),
            },
          },
        ],
      });
    } else {
      lineSrc.setData({ type: "FeatureCollection", features: [] });
    }
  }

  private updatePreview(cursor: maplibregl.LngLat): void {
    const src = this.map.getSource(SOURCE_PREVIEW) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!src || !this.route) return;

    const wps = this.route.waypoints;
    if (wps.length === 0) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const last = wps[wps.length - 1];
    src.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [last.lon, last.lat],
              [cursor.lng, cursor.lat],
            ],
          },
        },
      ],
    });
  }

  private clearSources(): void {
    for (const sid of [SOURCE_ID, SOURCE_LINE, SOURCE_PREVIEW]) {
      const src = this.map.getSource(sid) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (src) src.setData({ type: "FeatureCollection", features: [] });
    }
  }

  private updateBar(): void {
    if (!this.route) return;
    const wps = this.route.waypoints;
    if (wps.length === 0) {
      this.barText.textContent = "Click to place waypoints";
      return;
    }

    let totalDist = 0;
    const legs: string[] = [];
    for (let i = 1; i < wps.length; i++) {
      const d = haversineDistanceNM(
        wps[i - 1].lat,
        wps[i - 1].lon,
        wps[i].lat,
        wps[i].lon,
      );
      const b = initialBearingDeg(
        wps[i - 1].lat,
        wps[i - 1].lon,
        wps[i].lat,
        wps[i].lon,
      );
      totalDist += d;
      legs.push(`${d.toFixed(1)} NM / ${b.toFixed(0)}\u00b0`);
    }

    const lastLeg = legs.length > 0 ? legs[legs.length - 1] : "";
    this.barText.innerHTML =
      `<strong>${wps.length} WPs \u00b7 ${totalDist.toFixed(1)} NM</strong>` +
      (lastLeg ? ` \u00a0 Last: ${lastLeg}` : "");
  }
}

/** Assign a role to a waypoint by position. */
function pointRole(index: number, total: number): string {
  if (total <= 1) return "waypoint";
  if (index === 0) return "start";
  if (index === total - 1) return "finish";
  return "waypoint";
}
