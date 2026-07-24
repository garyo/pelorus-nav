/**
 * Interactive route editor. Tap a waypoint to select it (delete / insert
 * after), drag to reposition. Ghost handles insert a waypoint: one at each
 * leg's midpoint, plus one just off either end of the route that extends it
 * that way. Shows per-leg distance/bearing and running total. Preview line
 * follows cursor from last waypoint.
 *
 * Taps on open water append only while the Add Points toggle is on — on for
 * a route being drawn, off for a saved one being adjusted. Without that
 * split every tap that missed a handle grew the route, which is what field
 * reports of "spurious waypoints" turned out to be.
 *
 * Handles are hit-tested geometrically (see point-hit-test), not by querying
 * rendered symbols, so a tap right after a pan lands where the user aimed.
 *
 * Undo is snapshot-based: every mutation calls checkpoint() first, which
 * pushes a deep copy of {waypoints, selectedIndex}; undo() pops and
 * restores. Session-scoped — Cancel discards everything, Done resets.
 */

import type maplibregl from "maplibre-gl";
import { saveRoute } from "../data/db";
import type { Route, Waypoint } from "../data/Route";
import type { SearchEntry } from "../data/search-index";
import type { StandaloneWaypoint } from "../data/Waypoint";
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
import { type GeoPoint, nearestPointIndex } from "./point-hit-test";
import { ensurePointIcons, pointRole, ROLE_ICON_EXPR } from "./point-icons";
import type { RouteLayer } from "./RouteLayer";
import {
  collectSnapCandidates,
  findSnap,
  type SnapCandidate,
  type SnapOp,
} from "./route-snap";

/** Max fraction of first leg length for the prepend handle offset. */
const PREPEND_MAX_FRACTION = 0.8;
/** Min offset in degrees (~440m at mid-latitudes). */
const PREPEND_MIN_OFFSET_DEG = 0.004;

/** Reach of the handle hit test (px): icon half-width plus finger slop. The
 *  ghosts draw smaller than the waypoints, but a smaller target is no easier
 *  to hit, so they share one radius and the nearest handle wins. */
const HANDLE_HIT_RADIUS = 22;

/** A handle just beyond `end`, continuing the line away from `inner` —
 *  the extend-the-route grip at either end of the route. */
function extendHandlePos(
  end: Waypoint,
  inner: Waypoint,
): [number, number] | null {
  const dLat = end.lat - inner.lat;
  const dLon = end.lon - inner.lon;
  const len = Math.sqrt(dLat * dLat + dLon * dLon);
  if (len === 0) return null;
  const scale =
    Math.min(PREPEND_MAX_FRACTION, PREPEND_MIN_OFFSET_DEG / len) * len;
  return [end.lon + (dLon / len) * scale, end.lat + (dLat / len) * scale];
}

/** Handle off the start of the route, opposite the first leg. */
function prependHandlePos(wps: Waypoint[]): [number, number] | null {
  if (wps.length < 2) return null;
  return extendHandlePos(wps[0], wps[1]);
}

/** Handle off the end of the route, continuing the last leg. */
function appendHandlePos(wps: Waypoint[]): [number, number] | null {
  if (wps.length < 2) return null;
  return extendHandlePos(wps[wps.length - 1], wps[wps.length - 2]);
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
const SOURCE_SNAP = "_route-edit-snap";
const LAYER_SNAP = "_route-edit-snap";

type EditorListener = () => void;
type FinishListener = (route: Route) => void;

/** A ghost handle on the line: inserts after `insertAfter`, or prepends
 *  when that is null. Kept alongside the rendered features so the hit test
 *  and the drawn handles can never disagree. */
interface MidHandle {
  lat: number;
  lon: number;
  insertAfter: number | null;
}

export class RouteEditor {
  private readonly map: maplibregl.Map;
  private readonly routeLayer: RouteLayer;
  private route: Route | null = null;
  private editingExistingId: string | null = null;
  private selectedIndex: number | null = null;
  /** Ghost handles currently on the line, in the order they are drawn. */
  private midHandles: MidHandle[] = [];
  /** While on, a tap on open water appends a waypoint. Off, the chart is
   *  inert and only the handles respond — the difference between drawing a
   *  route and adjusting one, and the reason a stray tap can no longer put a
   *  spur on the end of a finished route. */
  private addingPoints = true;
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
  /** Source of standalone waypoints for snap targets. */
  private getSnapWaypoints: (() => readonly StandaloneWaypoint[]) | null = null;
  /** Snap targets outside the editing route (other visible routes +
   *  standalone waypoints), cached for the edit session. */
  private snapExternal: SnapCandidate[] = [];

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

    map.on("style.load", () => {
      this.setupLayers();
      // A style rebuild (theme, chart source, detail level) drops every
      // source; setupLayers re-adds ours empty. Without this an edit in
      // progress silently loses its line and handles — the route looks
      // deleted until the next mutation happens to redraw it.
      if (this.route) this.updateSources();
    });
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

  /** Provide a getter for standalone waypoints, used as snap targets when
   *  placing or dragging route waypoints. */
  setSnapWaypointsProvider(getter: () => readonly StandaloneWaypoint[]): void {
    this.getSnapWaypoints = getter;
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

    // Hide the existing route display while editing — and its selection
    // halo with it, so the only route shape on screen is the live one.
    this.routeLayer.setSelectionHaloHidden(true);
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

    // Cache external snap targets for the session — the route/waypoint set
    // can't change while the editor owns the interaction mode. The edited
    // route was hidden above, so getVisibleRoutes() already excludes it.
    this.snapExternal = collectSnapCandidates(
      this.routeLayer.getVisibleRoutes().filter((r) => r.id !== this.route?.id),
      this.getSnapWaypoints?.() ?? [],
      [],
    );

    this.selectedIndex = null;
    // Under two waypoints there is no route to adjust yet, so taps place
    // points. An existing route opens inert: that is what stops every
    // mis-aimed tap from hanging a spur off someone's finished route.
    this.addingPoints = this.route.waypoints.length < 2;
    setMode("route-edit");
    this.bar.style.display = "flex";
    this.updateBar();
    this.updateSources();
    this.setupDrag();
    this.stopTapDiag = startEditTapDiag(
      this.map,
      { points: LAYER_POINTS, midpoints: LAYER_MIDPOINTS },
      () => this.route?.waypoints ?? [],
      () => this.addingPoints,
    );

    this.clickHandler = (e: maplibregl.MapMouseEvent) => {
      if (getMode() !== "route-edit" || !this.route) return;

      // The mouse path. Touch never reaches here for a handle: DraggablePoints
      // consumes the gesture and suppresses the synthetic click, so the tap
      // and drag callbacks in setupDrag() mirror what happens here.
      const hit = this.hitHandle(e.point);
      if (hit) {
        if ("ghost" in hit) this.insertAtHandle(hit.ghost);
        else if (this.selectedIndex === hit.waypoint) this.deselect();
        else this.select(hit.waypoint);
        return;
      }

      // Background click: deselect if selected, otherwise append — but only
      // when the user has asked for adding.
      if (this.selectedIndex !== null) {
        this.deselect();
        return;
      }
      if (!this.addingPoints) return;

      const fallback = `WP${this.route.waypoints.length + 1}`;
      const snap = this.findSnapAt(e.point, this.appendOp());
      // Snapping copies the target's position and name — identical
      // coordinates, but no linkage between routes.
      const wp: Waypoint = snap
        ? { lat: snap.lat, lon: snap.lon, name: snap.name || fallback }
        : {
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
    };
    this.map.on("click", this.clickHandler);

    this.moveHandler = (e: maplibregl.MapMouseEvent) => {
      // Desktop hover feedback: ring the snap target and bend the preview
      // line onto it, so the snap is visible before the click commits. With
      // adding off there is nothing to preview — a line trailing the cursor
      // would promise a waypoint the click won't place.
      if (!this.addingPoints) return;
      const snap = this.findSnapAt(e.point, this.appendOp());
      this.showSnapIndicator(snap);
      this.updatePreview(snap ? { lng: snap.lon, lat: snap.lat } : e.lngLat);
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

  /**
   * Everything the user can grab, waypoints first then ghosts. One array
   * feeds the drag helper, the click path and the touch path, so all three
   * resolve a tap to the same handle — and a ghost's index in it is stable
   * enough to hand back to DraggablePoints mid-gesture.
   */
  private grabHandles(): GeoPoint[] {
    return [...(this.route?.waypoints ?? []), ...this.midHandles];
  }

  /** Split a grab-list index into the waypoint or ghost it refers to. */
  private resolveGrab(
    index: number,
  ): { waypoint: number } | { ghost: MidHandle } | null {
    const count = this.route?.waypoints.length ?? 0;
    if (index < count) return { waypoint: index };
    const ghost = this.midHandles[index - count];
    return ghost ? { ghost } : null;
  }

  /** The handle under a screen point — nearest wins — or null. */
  private hitHandle(point: {
    x: number;
    y: number;
  }): { waypoint: number } | { ghost: MidHandle } | null {
    const index = nearestPointIndex(
      this.grabHandles(),
      point,
      (ll) => this.map.project(ll),
      HANDLE_HIT_RADIUS,
    );
    return index === null ? null : this.resolveGrab(index);
  }

  /** Turn a ghost handle into a real waypoint (and select it). */
  private insertAtHandle(handle: MidHandle): void {
    if (handle.insertAfter === null) {
      this.prependWaypoint(handle.lat, handle.lon);
    } else {
      this.insertWaypointAfter(handle.insertAfter, handle.lat, handle.lon);
    }
  }

  private appendOp(): SnapOp {
    return {
      kind: "append",
      lastIndex: (this.route?.waypoints.length ?? 0) - 1,
    };
  }

  /** Nearest snap target to a screen point, or null. Merges the cached
   *  external targets with the route's own (live) waypoints. */
  private findSnapAt(
    point: { x: number; y: number },
    op: SnapOp,
  ): SnapCandidate | null {
    if (!this.route) return null;
    const candidates = [
      ...this.snapExternal,
      ...collectSnapCandidates([], [], this.route.waypoints),
    ];
    return findSnap(candidates, op, point, (ll) => this.map.project(ll));
  }

  /** Show (or with null, hide) the ring marking the current snap target. */
  private showSnapIndicator(c: SnapCandidate | null): void {
    const src = this.map.getSource(SOURCE_SNAP) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: c
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "Point", coordinates: [c.lon, c.lat] },
            },
          ]
        : [],
    });
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
    // Restore the original route display, then the halo — in that order, so
    // it anchors below a route line layer that exists again.
    if (this.editingExistingId) {
      this.routeLayer.toggleVisibility(this.editingExistingId, true);
      this.editingExistingId = null;
    }
    this.routeLayer.setSelectionHaloHidden(false);

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

    this.map.addSource(SOURCE_SNAP, {
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

    // Snap-target ring: marks the waypoint a placed/dragged point will
    // snap onto (see route-snap.ts).
    this.map.addLayer({
      id: LAYER_SNAP,
      type: "circle",
      source: SOURCE_SNAP,
      paint: {
        "circle-radius": 14,
        "circle-color": "transparent",
        "circle-stroke-color": "#00d0ff",
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
        "icon-size": 1,
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

  /** One helper per edit session. It reads the handle positions through a
   *  live getter, so mutations need not rebuild it — and rebuilding mid-drag
   *  would drop the gesture that a ghost handle has just handed over. */
  private setupDrag(): void {
    if (this.draggable) this.draggable.destroy();
    this.draggable = new DraggablePoints(
      this.map,
      LAYER_POINTS,
      (index, lngLat) => {
        if (!this.route) return;
        const wp = this.route.waypoints[index];
        if (!wp) return;
        const snap = this.findSnapAt(
          this.map.project([lngLat.lng, lngLat.lat]),
          { kind: "drag", index },
        );
        this.showSnapIndicator(snap);
        wp.lat = snap ? snap.lat : lngLat.lat;
        wp.lon = snap ? snap.lon : lngLat.lng;
        this.selectedIndex = index;
        this.updateSources();
        // Keep the toolbar's live leg distance/bearing running: placing a
        // waypoint at a distance and bearing is the point of the drag.
        this.updateBar();
      },
      // Touch tap on a handle: DraggablePoints consumes the touch (its
      // preventDefault suppresses the synthetic click, so clickHandler never
      // sees it) — mirror what the click path does with the same handle.
      (index) => {
        const hit = this.resolveGrab(index);
        if (!hit) return;
        if ("ghost" in hit) this.insertAtHandle(hit.ghost);
        else if (this.selectedIndex === hit.waypoint) this.deselect();
        else this.select(hit.waypoint);
      },
      // First movement of a gesture. Dragging a ghost places its waypoint
      // here and hands the gesture straight to it, so drag-from-a-ghost is
      // one motion instead of tap-then-find-it-again. The insert takes its
      // own checkpoint, so the whole gesture undoes in one step.
      (index) => {
        const hit = this.resolveGrab(index);
        if (!hit || "waypoint" in hit) {
          this.checkpoint();
          return;
        }
        this.insertAtHandle(hit.ghost);
        return this.selectedIndex ?? undefined;
      },
      // Gesture over — the snap ring must not linger on the target.
      () => this.showSnapIndicator(null),
      {
        getPoints: () => this.grabHandles(),
        hitRadius: HANDLE_HIT_RADIUS,
      },
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
    this.midHandles = [];
    const prependPos = prependHandlePos(wps);
    if (prependPos) {
      this.midHandles.push({
        lon: prependPos[0],
        lat: prependPos[1],
        insertAfter: null,
      });
    }
    for (let i = 0; i < wps.length - 1; i++) {
      this.midHandles.push({
        lat: (wps[i].lat + wps[i + 1].lat) / 2,
        lon: (wps[i].lon + wps[i + 1].lon) / 2,
        insertAfter: i,
      });
    }
    // Extending off the end is just an insert after the last waypoint.
    const appendPos = appendHandlePos(wps);
    if (appendPos) {
      this.midHandles.push({
        lon: appendPos[0],
        lat: appendPos[1],
        insertAfter: wps.length - 1,
      });
    }
    if (midSrc) {
      midSrc.setData({
        type: "FeatureCollection",
        features: this.midHandles.map((h) => ({
          type: "Feature",
          properties: { role: "midpoint" },
          geometry: { type: "Point", coordinates: [h.lon, h.lat] },
        })),
      });
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

  private updatePreview(cursor: { lng: number; lat: number } | null): void {
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

    // Dashed stubs tying each extend handle back to the end it grows from.
    const stubs: [Waypoint, [number, number] | null][] = [
      [wps[0], prependHandlePos(wps)],
      [wps[wps.length - 1], appendHandlePos(wps)],
    ];
    for (const [from, pos] of stubs) {
      if (!pos) continue;
      features.push({
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [[from.lon, from.lat], pos],
        },
      });
    }

    src.setData({ type: "FeatureCollection", features });
  }

  private clearSources(): void {
    this.midHandles = [];
    for (const sid of [
      SOURCE_ID,
      SOURCE_LINE,
      SOURCE_PREVIEW,
      SOURCE_MIDPOINTS,
      SOURCE_HIGHLIGHT,
      SOURCE_SNAP,
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

  /** Add the Add Points toggle — lit while taps place waypoints. It is the
   *  only on-screen sign of which mode the chart is in, so it shows in both
   *  bar states. */
  private appendAddToggle(): void {
    const btn = document.createElement("button");
    btn.className = this.addingPoints
      ? "route-editor-btn route-editor-btn--active"
      : "route-editor-btn route-editor-btn--secondary";
    btn.textContent = "Add Points";
    btn.title = this.addingPoints
      ? "Tapping the chart adds a waypoint — tap to stop"
      : "Tap to add waypoints by tapping the chart";
    btn.addEventListener("click", () =>
      this.setAddingPoints(!this.addingPoints),
    );
    this.barActions.appendChild(btn);
  }

  /** Turn tap-to-append on or off. */
  private setAddingPoints(on: boolean): void {
    this.addingPoints = on;
    // A trailing preview line would outlive the mode that draws it.
    if (!on) {
      this.updatePreview(null);
      this.showSnapIndicator(null);
    }
    this.updateBar();
  }

  private updateBar(): void {
    if (!this.route) return;
    const wps = this.route.waypoints;
    this.barActions.innerHTML = "";

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

      const delBtn = document.createElement("button");
      delBtn.className = "route-editor-btn route-editor-btn--danger";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => this.deleteSelected());

      const insBtn = document.createElement("button");
      insBtn.className = "route-editor-btn route-editor-btn--secondary";
      insBtn.textContent = "Insert After";
      insBtn.addEventListener("click", () => this.insertAfterSelected());

      this.barActions.append(delBtn, insBtn);
      this.appendAddToggle();
      this.appendUndoButton();
      return;
    }

    // Normal mode: summary
    this.appendAddToggle();
    this.appendUndoButton();

    if (wps.length === 0) {
      this.barText.textContent = "Tap the chart to place waypoints";
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
