/**
 * Interactive route editor. Click to add waypoints, drag to reposition.
 * Tap a waypoint to select it (delete / insert after).
 * Ghost midpoints on legs allow inserting waypoints between existing ones.
 * Shows per-leg distance/bearing and running total.
 * Preview line follows cursor from last waypoint.
 *
 * Undo is snapshot-based: every mutation calls checkpoint() first, which
 * pushes a deep copy of {waypoints, selectedIndex}; undo() pops and
 * restores. Session-scoped — Cancel discards everything, Done resets.
 */

import type maplibregl from "maplibre-gl";
import { saveRoute } from "../data/db";
import type { Route, Waypoint } from "../data/Route";
import type { SearchEntry } from "../data/search-index";
import { findNearestNamedFeature } from "../search/feature-search";
import { getSettings } from "../settings";
import { haversineDistanceNM, initialBearingDeg } from "../utils/coordinates";
import {
  abbreviateFeatureName,
  isNearDuplicateName,
} from "../utils/feature-name";
import { formatLocalDateTime } from "../utils/format";
import { formatBearing } from "../utils/magnetic";
import { UndoStack } from "../utils/undo-stack";
import { generateUUID } from "../utils/uuid";
import { DraggablePoints } from "./DraggablePoints";
import { startEditTapDiag } from "./editTapDiag";
import { getMode, setMode } from "./InteractionMode";
import { ensurePointIcons, pointRole, ROLE_ICON_EXPR } from "./point-icons";
import type { RouteLayer } from "./RouteLayer";

/** Max fraction of first leg length for the prepend handle offset. */
const PREPEND_MAX_FRACTION = 0.8;
/** Min offset in degrees (~440m at mid-latitudes). */
const PREPEND_MIN_OFFSET_DEG = 0.004;

/** Compute the prepend handle position — offset from start, opposite the first leg. */
function prependHandlePos(wps: Waypoint[]): [number, number] | null {
  if (wps.length < 2) return null;
  const dLat = wps[0].lat - wps[1].lat;
  const dLon = wps[0].lon - wps[1].lon;
  const len = Math.sqrt(dLat * dLat + dLon * dLon);
  if (len === 0) return null;
  const scale =
    Math.min(PREPEND_MAX_FRACTION, PREPEND_MIN_OFFSET_DEG / len) * len;
  return [wps[0].lon + (dLon / len) * scale, wps[0].lat + (dLat / len) * scale];
}

const SOURCE_ID = "_route-edit-points";
const LAYER_POINTS = "_route-edit-points";
const SOURCE_MIDPOINTS = "_route-edit-midpoints";
const LAYER_MIDPOINTS = "_route-edit-midpoints";
const SOURCE_LINE = "_route-edit-line";
const LAYER_LINE = "_route-edit-line";
const SOURCE_PREVIEW = "_route-edit-preview";
const LAYER_PREVIEW = "_route-edit-preview";
const SOURCE_HIGHLIGHT = "_route-edit-highlight";
const LAYER_HIGHLIGHT = "_route-edit-highlight";

type EditorListener = () => void;
type FinishListener = (route: Route) => void;

export class RouteEditor {
  private readonly map: maplibregl.Map;
  private readonly routeLayer: RouteLayer;
  private route: Route | null = null;
  private editingExistingId: string | null = null;
  private selectedIndex: number | null = null;
  private draggable: DraggablePoints | null = null;
  private clickHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private moveHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private stopTapDiag: (() => void) | null = null;
  private bar: HTMLDivElement;
  private barText: HTMLDivElement;
  private barActions: HTMLDivElement;
  private readonly undoStack = new UndoStack<{
    waypoints: Waypoint[];
    selectedIndex: number | null;
  }>();
  private listeners: EditorListener[] = [];
  private finishListeners: FinishListener[] = [];
  private cancelListeners: ((existingId: string | null) => void)[] = [];
  /** Source of charted-feature names for waypoint auto-naming. */
  private getSearchEntries: (() => SearchEntry[]) | null = null;

  constructor(map: maplibregl.Map, routeLayer: RouteLayer) {
    this.map = map;
    this.routeLayer = routeLayer;

    this.bar = document.createElement("div");
    this.bar.className = "route-editor-bar";
    this.bar.style.display = "none";
    this.bar.innerHTML =
      '<div class="route-editor-text"></div>' +
      '<div class="route-editor-actions"></div>' +
      '<button class="route-editor-btn">Done</button>' +
      '<button class="route-editor-btn route-editor-btn--cancel">Cancel</button>';
    document.body.appendChild(this.bar);

    this.barText = this.bar.querySelector(
      ".route-editor-text",
    ) as HTMLDivElement;
    this.barActions = this.bar.querySelector(
      ".route-editor-actions",
    ) as HTMLDivElement;
    this.bar
      .querySelector(".route-editor-btn:not(.route-editor-btn--cancel)")
      ?.addEventListener("click", () => this.finish());
    this.bar
      .querySelector(".route-editor-btn--cancel")
      ?.addEventListener("click", () => this.cancel());

    // Desktop convenience: Cmd/Ctrl+Z undoes while editing (inputs keep
    // their own undo).
    document.addEventListener("keydown", (e) => {
      if (!this.route || !(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() !== "z" || e.shiftKey) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      this.undo();
    });

    map.on("style.load", () => this.setupLayers());
    if (map.isStyleLoaded()) this.setupLayers();
  }

  isEditing(): boolean {
    return this.route !== null;
  }

  onEditorChange(fn: EditorListener): void {
    this.listeners.push(fn);
  }

  onFinish(fn: FinishListener): void {
    this.finishListeners.push(fn);
  }

  onCancel(fn: (existingId: string | null) => void): void {
    this.cancelListeners.push(fn);
  }

  /** Provide a synchronous getter for the loaded chart-feature search
   *  entries; used to auto-name new waypoints from the nearest charted
   *  feature when one is close enough. */
  setSearchEntriesProvider(getter: () => SearchEntry[]): void {
    this.getSearchEntries = getter;
  }

  getRoute(): Route | null {
    return this.route;
  }

  /** Currently selected waypoint index, or null. */
  getSelectedIndex(): number | null {
    return this.selectedIndex;
  }

  /** Select (or deselect with null) a waypoint programmatically — same
   *  effect as tapping it on the map. With reveal, ease the map to the
   *  waypoint if it's off-screen. */
  setSelectedIndex(index: number | null, opts?: { reveal?: boolean }): void {
    if (index === null) {
      this.deselect();
      return;
    }
    this.select(index);
    if (opts?.reveal) {
      const wp = this.route?.waypoints[this.selectedIndex ?? -1];
      if (wp && !this.map.getBounds().contains([wp.lon, wp.lat])) {
        this.map.easeTo({ center: [wp.lon, wp.lat], duration: 400 });
      }
    }
  }

  /** Pick a default name for a new waypoint at (lat, lon): the nearest
   *  named chart feature within ~200 m, or the WP-N fallback. When the
   *  feature-derived name duplicates an adjacent waypoint close by (both
   *  points near the same feature), the numbered fallback is used instead —
   *  repeated names on neighboring points are clutter. */
  private autoName(
    lat: number,
    lon: number,
    fallback: string,
    neighbors: Waypoint[] = [],
  ): string {
    const entries = this.getSearchEntries?.();
    if (entries && entries.length > 0) {
      const hit = findNearestNamedFeature(lon, lat, entries);
      if (hit) {
        const name = abbreviateFeatureName(hit.name);
        if (!isNearDuplicateName(name, lat, lon, neighbors)) return name;
      }
    }
    return fallback;
  }

  /** Start a new route with the first waypoint at the given position. */
  startFromPoint(lat: number, lon: number): void {
    this.startEditing({
      id: generateUUID(),
      name: `Route ${formatLocalDateTime(new Date())}`,
      createdAt: Date.now(),
      color: "#4488cc",
      visible: true,
      waypoints: [{ lat, lon, name: this.autoName(lat, lon, "WP1") }],
    });
  }

  /** Start editing a new or existing route. */
  startEditing(route?: Route): void {
    // Re-entry guard: starting a new edit while one is active would leak the
    // old map handlers (every click then appends two waypoints). Tear the
    // previous session down first — same teardown as cancel, minus the bar.
    if (this.route !== null) {
      this.cleanup();
    }

    // Hide the existing route display while editing
    this.editingExistingId = route?.id ?? null;
    if (this.editingExistingId) {
      this.routeLayer.toggleVisibility(this.editingExistingId, false);
    }

    this.route = route ?? {
      id: generateUUID(),
      name: `Route ${formatLocalDateTime(new Date())}`,
      createdAt: Date.now(),
      color: "#4488cc",
      visible: true,
      waypoints: [],
    };

    // Frame an existing route before editing — appending to an off-screen
    // route drops waypoints sight-unseen. Single-waypoint routes (context
    // menu "start route here") skip it: the point is already on screen and
    // a degenerate bbox would yank the camera to max zoom.
    if (route && route.waypoints.length >= 2) {
      this.routeLayer.fitRoute(route);
    }

    this.selectedIndex = null;
    setMode("route-edit");
    this.bar.style.display = "flex";
    this.updateBar();
    this.updateSources();
    this.setupDrag();
    this.stopTapDiag = startEditTapDiag(
      this.map,
      { points: LAYER_POINTS, midpoints: LAYER_MIDPOINTS },
      () => this.route?.waypoints ?? [],
    );

    this.clickHandler = (e: maplibregl.MapMouseEvent) => {
      if (getMode() !== "route-edit" || !this.route) return;

      // Check midpoint click first (insert between waypoints or prepend)
      const midFeatures = this.map.queryRenderedFeatures(e.point, {
        layers: [LAYER_MIDPOINTS],
      });
      if (midFeatures.length > 0) {
        const props = midFeatures[0].properties;
        if (props?.insertBefore === 0) {
          this.prependWaypoint(e.lngLat.lat, e.lngLat.lng);
        } else {
          const insertAfter = (props?.insertAfter as number) ?? 0;
          this.insertWaypointAfter(insertAfter, e.lngLat.lat, e.lngLat.lng);
        }
        return;
      }

      // Check waypoint click (select/deselect)
      const wpFeatures = this.map.queryRenderedFeatures(e.point, {
        layers: [LAYER_POINTS],
      });
      if (wpFeatures.length > 0) {
        const clickedIndex = (wpFeatures[0].properties?.index as number) ?? -1;
        if (this.selectedIndex === clickedIndex) {
          this.deselect();
        } else {
          this.select(clickedIndex);
        }
        return;
      }

      // Background click: deselect if selected, otherwise append
      if (this.selectedIndex !== null) {
        this.deselect();
        return;
      }

      const fallback = `WP${this.route.waypoints.length + 1}`;
      const wp: Waypoint = {
        lat: e.lngLat.lat,
        lon: e.lngLat.lng,
        name: this.autoName(
          e.lngLat.lat,
          e.lngLat.lng,
          fallback,
          this.route.waypoints.slice(-1),
        ),
      };
      this.checkpoint();
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
    const finishedRoute = this.route;
    await saveRoute(this.route);
    this.routeLayer.updateRoute(this.route);
    this.cleanup();
    await this.routeLayer.reloadAll();
    this.notify();
    for (const fn of this.finishListeners) fn(finishedRoute);
  }

  /** Cancel without saving. */
  cancel(): void {
    const existingId = this.editingExistingId;
    this.cleanup();
    this.notify();
    for (const fn of this.cancelListeners) fn(existingId);
  }

  /** Snapshot state before a mutation; one Undo press restores it. */
  private checkpoint(): void {
    if (!this.route) return;
    this.undoStack.push({
      waypoints: structuredClone(this.route.waypoints),
      selectedIndex: this.selectedIndex,
    });
  }

  /** Restore the state before the last mutation (add/insert/delete/drag/
   *  rename). No redo; session-scoped. */
  undo(): void {
    const snap = this.undoStack.pop();
    if (!this.route || !snap) return;
    this.route.waypoints = snap.waypoints;
    this.selectedIndex = snap.selectedIndex;
    this.updateSources();
    this.updateBar();
    this.setupDrag();
  }

  /** Rename a waypoint during editing. Undoable; Done persists it,
   *  Cancel discards it. */
  renameWaypoint(index: number, name: string): void {
    const wp = this.route?.waypoints[index];
    if (!wp || wp.name === name) return;
    this.checkpoint();
    wp.name = name;
    this.updateSources();
    this.updateBar();
  }

  private select(index: number): void {
    if (!this.route || index < 0 || index >= this.route.waypoints.length)
      return;
    this.selectedIndex = index;
    this.updateSources();
    this.updateBar();
  }

  private deselect(): void {
    this.selectedIndex = null;
    this.updateSources();
    this.updateBar();
  }

  private deleteSelected(): void {
    if (!this.route || this.selectedIndex === null) return;
    this.checkpoint();
    this.route.waypoints.splice(this.selectedIndex, 1);
    // Renumber names
    for (let i = 0; i < this.route.waypoints.length; i++) {
      if (this.route.waypoints[i].name.match(/^WP\d+$/)) {
        this.route.waypoints[i].name = `WP${i + 1}`;
      }
    }
    this.selectedIndex = null;
    this.updateSources();
    this.updateBar();
    this.setupDrag();
  }

  private prependWaypoint(lat: number, lon: number): void {
    if (!this.route) return;
    this.checkpoint();
    // Only the new waypoint gets an auto-name; existing waypoints keep
    // whatever names the user has set (renumbering would clobber custom
    // and feature-derived names).
    const newWp: Waypoint = {
      lat,
      lon,
      name: this.autoName(
        lat,
        lon,
        `WP${this.route.waypoints.length + 1}`,
        this.route.waypoints.slice(0, 1),
      ),
    };
    this.route.waypoints.unshift(newWp);
    this.selectedIndex = 0;
    this.updateSources();
    this.updateBar();
    this.setupDrag();
  }

  private insertWaypointAfter(
    afterIndex: number,
    lat: number,
    lon: number,
  ): void {
    if (!this.route) return;
    this.checkpoint();
    const newWp: Waypoint = {
      lat,
      lon,
      name: this.autoName(
        lat,
        lon,
        `WP${this.route.waypoints.length + 1}`,
        // both sides of the insertion point
        this.route.waypoints.slice(afterIndex, afterIndex + 2),
      ),
    };
    this.route.waypoints.splice(afterIndex + 1, 0, newWp);
    this.selectedIndex = afterIndex + 1;
    this.updateSources();
    this.updateBar();
    this.setupDrag();
  }

  private insertAfterSelected(): void {
    if (!this.route || this.selectedIndex === null) return;
    const wps = this.route.waypoints;
    const idx = this.selectedIndex;
    let lat: number;
    let lon: number;
    if (idx < wps.length - 1) {
      // Midpoint between selected and next
      lat = (wps[idx].lat + wps[idx + 1].lat) / 2;
      lon = (wps[idx].lon + wps[idx + 1].lon) / 2;
    } else {
      // After last point: offset slightly
      lat = wps[idx].lat + 0.005;
      lon = wps[idx].lon + 0.005;
    }
    this.insertWaypointAfter(idx, lat, lon);
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
    if (this.stopTapDiag) {
      this.stopTapDiag();
      this.stopTapDiag = null;
    }
    this.route = null;
    this.selectedIndex = null;
    this.undoStack.clear();
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

    this.map.addSource(SOURCE_MIDPOINTS, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    this.map.addSource(SOURCE_HIGHLIGHT, {
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

    // Selection highlight ring (rendered below waypoint icons)
    this.map.addLayer({
      id: LAYER_HIGHLIGHT,
      type: "circle",
      source: SOURCE_HIGHLIGHT,
      paint: {
        "circle-radius": 18,
        "circle-color": "transparent",
        "circle-stroke-color": "#ffcc00",
        "circle-stroke-width": 3,
      },
    });

    ensurePointIcons(this.map);

    // Ghost midpoints (smaller, semi-transparent)
    this.map.addLayer({
      id: LAYER_MIDPOINTS,
      type: "symbol",
      source: SOURCE_MIDPOINTS,
      layout: {
        "icon-image": ROLE_ICON_EXPR,
        "icon-size": 0.8,
        "icon-allow-overlap": true,
      },
    });

    // Real waypoints on top
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
        this.selectedIndex = index;
        this.updateSources();
        this.updateBar();
      },
      // Touch tap on a waypoint: DraggablePoints consumes the touch (its
      // preventDefault suppresses the synthetic click, so clickHandler
      // never sees it) — mirror the click path's select/deselect toggle.
      (index) => {
        if (this.selectedIndex === index) {
          this.deselect();
        } else {
          this.select(index);
        }
      },
      // One checkpoint per drag gesture, taken before the first movement.
      () => this.checkpoint(),
    );
  }

  private updateSources(): void {
    if (!this.route) return;
    this.notify();
    // Drop any stale cursor-preview line (the next mousemove redraws it;
    // touch devices never get one). Keeps the prepend-handle dash fresh.
    this.updatePreview(null);
    const wps = this.route.waypoints;

    const ptSrc = this.map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    const lineSrc = this.map.getSource(SOURCE_LINE) as
      | maplibregl.GeoJSONSource
      | undefined;
    const midSrc = this.map.getSource(SOURCE_MIDPOINTS) as
      | maplibregl.GeoJSONSource
      | undefined;
    const hlSrc = this.map.getSource(SOURCE_HIGHLIGHT) as
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

    // Ghost midpoints between consecutive waypoints + prepend handle
    if (midSrc) {
      const midpoints: GeoJSON.Feature[] = [];

      const prependPos = prependHandlePos(wps);
      if (prependPos) {
        midpoints.push({
          type: "Feature",
          properties: { role: "midpoint", insertBefore: 0 },
          geometry: { type: "Point", coordinates: prependPos },
        });
      }

      for (let i = 0; i < wps.length - 1; i++) {
        const midLat = (wps[i].lat + wps[i + 1].lat) / 2;
        const midLon = (wps[i].lon + wps[i + 1].lon) / 2;
        midpoints.push({
          type: "Feature",
          properties: { role: "midpoint", insertAfter: i },
          geometry: { type: "Point", coordinates: [midLon, midLat] },
        });
      }
      midSrc.setData({ type: "FeatureCollection", features: midpoints });
    }

    // Selection highlight
    if (hlSrc) {
      if (this.selectedIndex !== null && wps[this.selectedIndex]) {
        const sel = wps[this.selectedIndex];
        hlSrc.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "Point", coordinates: [sel.lon, sel.lat] },
            },
          ],
        });
      } else {
        hlSrc.setData({ type: "FeatureCollection", features: [] });
      }
    }

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

  private updatePreview(cursor: maplibregl.LngLat | null): void {
    const src = this.map.getSource(SOURCE_PREVIEW) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!src || !this.route) return;

    const wps = this.route.waypoints;
    if (wps.length === 0) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const features: GeoJSON.Feature[] = [];

    // Append preview: dashed line from last waypoint to cursor. Cursor is
    // null on touch devices (no mousemove) and right after a mutation —
    // the stale line would otherwise point at a deleted/moved waypoint.
    if (cursor) {
      const last = wps[wps.length - 1];
      features.push({
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            [last.lon, last.lat],
            [cursor.lng, cursor.lat],
          ],
        },
      });
    }

    const prependPos = prependHandlePos(wps);
    if (prependPos) {
      features.push({
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [[wps[0].lon, wps[0].lat], prependPos],
        },
      });
    }

    src.setData({ type: "FeatureCollection", features });
  }

  private clearSources(): void {
    for (const sid of [
      SOURCE_ID,
      SOURCE_LINE,
      SOURCE_PREVIEW,
      SOURCE_MIDPOINTS,
      SOURCE_HIGHLIGHT,
    ]) {
      const src = this.map.getSource(sid) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (src) src.setData({ type: "FeatureCollection", features: [] });
    }
  }

  /** Add an Undo action to the bar — only when there is something to undo. */
  private appendUndoButton(): void {
    if (this.undoStack.isEmpty) return;
    const btn = document.createElement("button");
    btn.className = "route-editor-btn route-editor-btn--secondary";
    btn.textContent = "Undo";
    btn.title = "Undo last change (Ctrl/Cmd+Z)";
    btn.addEventListener("click", () => this.undo());
    this.barActions.appendChild(btn);
  }

  private updateBar(): void {
    if (!this.route) return;
    const wps = this.route.waypoints;

    // Selection mode: show selected WP info with leg course/distance
    if (this.selectedIndex !== null && wps[this.selectedIndex]) {
      const wp = wps[this.selectedIndex];
      const label = wp.name || `WP${this.selectedIndex + 1}`;
      const { bearingMode } = getSettings();
      let legInfo = "";
      if (this.selectedIndex > 0) {
        const prev = wps[this.selectedIndex - 1];
        const d = haversineDistanceNM(prev.lat, prev.lon, wp.lat, wp.lon);
        const b = initialBearingDeg(prev.lat, prev.lon, wp.lat, wp.lon);
        legInfo = ` \u2014 ${d.toFixed(1)} NM / ${formatBearing(b, bearingMode, prev.lat, prev.lon)}`;
      }
      this.barText.innerHTML = "";
      const strong = document.createElement("strong");
      strong.textContent = label;
      this.barText.appendChild(strong);
      if (legInfo) {
        const span = document.createElement("span");
        span.textContent = legInfo;
        this.barText.appendChild(span);
      }

      this.barActions.innerHTML = "";
      const delBtn = document.createElement("button");
      delBtn.className = "route-editor-btn route-editor-btn--danger";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => this.deleteSelected());

      const insBtn = document.createElement("button");
      insBtn.className = "route-editor-btn route-editor-btn--secondary";
      insBtn.textContent = "Insert After";
      insBtn.addEventListener("click", () => this.insertAfterSelected());

      this.barActions.append(delBtn, insBtn);
      this.appendUndoButton();
      return;
    }

    // Normal mode: summary
    this.barActions.innerHTML = "";
    this.appendUndoButton();

    if (wps.length === 0) {
      this.barText.textContent = "Click to place waypoints";
      return;
    }

    let totalDist = 0;
    const legs: string[] = [];
    const { bearingMode } = getSettings();
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
      legs.push(
        `${d.toFixed(1)} NM / ${formatBearing(b, bearingMode, wps[i - 1].lat, wps[i - 1].lon)}`,
      );
    }

    const lastLeg = legs.length > 0 ? legs[legs.length - 1] : "";
    this.barText.innerHTML =
      `<strong>${wps.length} WPs \u00b7 ${totalDist.toFixed(1)} NM</strong>` +
      (lastLeg ? ` \u00a0 Last: ${lastLeg}` : "");
  }
}
