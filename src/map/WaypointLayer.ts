/**
 * Renders standalone waypoints on the map with symbol + label layers.
 *
 * Moving one is press-and-hold, not touch-and-drag: these markers sit on the
 * ordinary chart, where a pan can start anywhere, and on a busy harbour a
 * touch-and-drag grab means panning silently relocates whichever waypoint the
 * finger happened to land on. The hold arms with a cue, and the move that
 * follows is undoable.
 */

import type * as maplibregl from "maplibre-gl";
import { getAllWaypoints, saveWaypoint } from "../data/db";
import type { StandaloneWaypoint } from "../data/Waypoint";
import { showToast } from "../ui/Toast";
import { DraggablePoints } from "./DraggablePoints";
import { focusMapOnPoint } from "./fit-bounds";
import { onModeChange } from "./InteractionMode";
import { belowVesselLayerId } from "./layer-order";
import { ensurePointIcons, waypointIconImage } from "./point-icons";
import { SelectionHalo } from "./selection-halo";
import { getWaypointScale, onWaypointScaleChange } from "./waypoint-scale";

const SOURCE_ID = "_waypoints";
const POINTS_LAYER = "_waypoints-points";
const LABELS_LAYER = "_waypoints-labels";
const HALO_SOURCE = "_waypoint-halo-src";
const HALO_LINE_LAYER = "_waypoint-halo-line";
const HALO_POINTS_LAYER = "_waypoint-halo-pts";

/**
 * How long a waypoint must be held before it can be dragged. Long enough that
 * no pan reaches it, short enough to arm before the chart's own 500 ms
 * long-press so the two never both fire (see press-claim.ts).
 */
const HOLD_TO_MOVE_MS = 350;

/** Buzz on pickup, where the hardware offers one. Short: a confirmation, not
 *  an alert. */
const GRAB_VIBRATE_MS = 25;

/** How long the halo stays up after revealing a waypoint from a list. */
const REVEAL_HALO_MS = 2500;

/** Glow radius for the ring, in px. Wide enough to stand clear of the marker
 *  it sits under, which the route-waypoint default is not. */
const HALO_RADIUS = 26;
const ICON_SIZE = 0.85;
const LABEL_TEXT_SIZE = 11;
/** Label offset is in ems of the (fixed) text size, so it scales with the
 *  waypoint-size setting to stay clear of the marker, not with the text.
 *  Anchored at the bottom of the text block, so a name that wraps grows
 *  upward instead of its second line landing on the marker. */
const LABEL_OFFSET_EM = -1;

export class WaypointLayer {
  private readonly map: maplibregl.Map;
  private waypoints: StandaloneWaypoint[] = [];
  private draggable: DraggablePoints | null = null;
  private changeListeners: Array<() => void> = [];
  private readonly halo: SelectionHalo;
  private haloTimer: ReturnType<typeof setTimeout> | null = null;
  /** Where the halo is showing, or null. Kept so a style rebuild can't
   *  quietly take the ring away mid-reveal. */
  private haloAt: [number, number] | null = null;
  /** Where the waypoint being dragged started, so the move can be undone.
   *  Held only between pickup and release. */
  private dragOrigin: { id: string; lat: number; lon: number } | null = null;

  constructor(map: maplibregl.Map) {
    this.map = map;
    this.halo = new SelectionHalo(map, {
      source: HALO_SOURCE,
      lineLayer: HALO_LINE_LAYER,
      pointsLayer: HALO_POINTS_LAYER,
      pointRadius: HALO_RADIUS,
    });
    map.on("style.load", () => this.setup());
    if (map.isStyleLoaded()) this.setup();

    onWaypointScaleChange((scale) => {
      if (!this.map.getLayer(POINTS_LAYER)) return;
      this.map.setLayoutProperty(POINTS_LAYER, "icon-size", ICON_SIZE * scale);
      this.map.setLayoutProperty(LABELS_LAYER, "text-offset", [
        0,
        LABEL_OFFSET_EM * scale,
      ]);
    });

    // Disable waypoint dragging during route-edit (and other non-query modes)
    onModeChange((mode) => {
      if (mode !== "query") {
        this.draggable?.destroy();
        this.draggable = null;
      } else {
        this.setupDrag();
      }
    });
  }

  /**
   * Subscribe to any change in the waypoint set (add/update/remove/reload/
   * drag). This is the one place list-UIs stay in sync from — callers that
   * mutate waypoints never need to poke the panel themselves.
   */
  onChange(fn: () => void): void {
    this.changeListeners.push(fn);
  }

  private notifyChange(): void {
    for (const fn of this.changeListeners) fn();
  }

  async reloadAll(): Promise<void> {
    this.waypoints = await getAllWaypoints();
    this.updateSource();
    this.notifyChange();
  }

  async addWaypoint(wp: StandaloneWaypoint): Promise<void> {
    await saveWaypoint(wp);
    this.waypoints.push(wp);
    this.updateSource();
    this.notifyChange();
  }

  async removeWaypoint(id: string): Promise<void> {
    this.waypoints = this.waypoints.filter((w) => w.id !== id);
    this.updateSource();
    this.notifyChange();
  }

  async updateWaypoint(wp: StandaloneWaypoint): Promise<void> {
    await saveWaypoint(wp);
    const idx = this.waypoints.findIndex((w) => w.id === wp.id);
    if (idx >= 0) {
      this.waypoints[idx] = wp;
    }
    this.updateSource();
    this.notifyChange();
  }

  getWaypoints(): readonly StandaloneWaypoint[] {
    return this.waypoints;
  }

  /** Standalone waypoints rendered within a screen-space box, topmost first. */
  hitTest(
    box: [maplibregl.PointLike, maplibregl.PointLike],
  ): StandaloneWaypoint[] {
    const layers = [POINTS_LAYER, LABELS_LAYER].filter((l) =>
      this.map.getLayer(l),
    );
    if (layers.length === 0) return [];
    const out: StandaloneWaypoint[] = [];
    const seen = new Set<string>();
    for (const f of this.map.queryRenderedFeatures(box, { layers })) {
      const id = f.properties?.id;
      if (typeof id !== "string" || seen.has(id)) continue;
      seen.add(id);
      const wp = this.waypoints.find((w) => w.id === id);
      if (wp) out.push(wp);
    }
    return out;
  }

  private async setup(): Promise<void> {
    this.waypoints = await getAllWaypoints();

    // Always re-register canvas-drawn icons — they can be lost after
    // setStyle({ diff: true }) even when the source/layers persist.
    ensurePointIcons(this.map);

    if (this.map.getSource(SOURCE_ID)) {
      this.updateSource();
      this.restoreHalo();
      return;
    }

    this.map.addSource(SOURCE_ID, {
      type: "geojson",
      data: this.buildGeoJSON(),
    });

    // Below the vessel stack — the boat draws above waypoint markers
    // (see layer-order.ts).
    const beforeId = belowVesselLayerId(this.map);

    this.map.addLayer(
      {
        id: POINTS_LAYER,
        type: "symbol",
        source: SOURCE_ID,
        layout: {
          "icon-image": ["get", "iconImage"],
          "icon-size": ICON_SIZE * getWaypointScale(),
          "icon-allow-overlap": true,
        },
      },
      beforeId,
    );

    this.map.addLayer(
      {
        id: LABELS_LAYER,
        type: "symbol",
        source: SOURCE_ID,
        layout: {
          "text-field": ["get", "name"],
          // Bundled stack — see RouteLayer label layer for why this is required
          "text-font": ["Noto Sans Regular"],
          "text-size": LABEL_TEXT_SIZE,
          "text-anchor": "bottom",
          "text-offset": [0, LABEL_OFFSET_EM * getWaypointScale()],
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#fff",
          "text-halo-color": "rgba(0,0,0,0.7)",
          "text-halo-width": 1,
        },
      },
      beforeId,
    );

    // After the marker layers, which the halo is inserted beneath: a style
    // rebuild takes the halo's layers with it, and revealing a waypoint moves
    // the camera — exactly what provokes one — so the ring has to be able to
    // outlive the rebuild it caused.
    this.restoreHalo();
    this.setupDrag();
  }

  private setupDrag(): void {
    if (this.draggable) return;
    this.draggable = new DraggablePoints(
      this.map,
      POINTS_LAYER,
      (featureIndex, lngLat) => {
        const wp = this.waypoints[featureIndex];
        if (!wp) return;
        wp.lat = lngLat.lat;
        wp.lon = lngLat.lng;
        wp.updatedAt = Date.now();
        this.showHalo(wp);
        this.updateSource();
        this.notifyChange();
        saveWaypoint(wp).catch(console.error);
      },
      null,
      null,
      () => this.onDragEnd(),
      {
        holdMs: HOLD_TO_MOVE_MS,
        onGrab: (featureIndex) => this.onGrab(featureIndex),
      },
    );
  }

  /** The hold armed: mark the waypoint as picked up and remember where it
   *  was, so the move it's about to make can be taken back. */
  private onGrab(featureIndex: number): void {
    const wp = this.waypoints[featureIndex];
    if (!wp) return;
    this.dragOrigin = { id: wp.id, lat: wp.lat, lon: wp.lon };
    this.showHalo(wp);
    navigator.vibrate?.(GRAB_VIBRATE_MS);
  }

  /** Released. A waypoint that actually moved gets an undo offer — this is
   *  the only edit on the chart with no dialog in front of it. */
  private onDragEnd(): void {
    const origin = this.dragOrigin;
    this.dragOrigin = null;
    this.clearHalo();
    if (!origin) return;
    const wp = this.waypoints.find((w) => w.id === origin.id);
    if (!wp || (wp.lat === origin.lat && wp.lon === origin.lon)) return;
    const moved = wp;
    showToast({
      message: `Moved "${moved.name}"`,
      actionLabel: "Undo",
      onAction: () => {
        moved.lat = origin.lat;
        moved.lon = origin.lon;
        moved.updatedAt = Date.now();
        this.updateSource();
        this.notifyChange();
        saveWaypoint(moved).catch(console.error);
      },
    });
  }

  /**
   * Center the chart on a waypoint and ring it — the answer to "where is
   * this one?" asked from a list. Hidden waypoints are shown first: a halo
   * around nothing answers no question.
   */
  async revealWaypoint(wp: StandaloneWaypoint): Promise<void> {
    if (!wp.visible) {
      wp.visible = true;
      wp.updatedAt = Date.now();
      await this.updateWaypoint(wp);
    }
    focusMapOnPoint(this.map, [wp.lon, wp.lat]);
    this.showHalo(wp, REVEAL_HALO_MS);
  }

  /** Ring a waypoint, optionally clearing the ring after `timeoutMs`. */
  private showHalo(wp: StandaloneWaypoint, timeoutMs?: number): void {
    if (this.haloTimer) clearTimeout(this.haloTimer);
    this.haloTimer = null;
    this.haloAt = [wp.lon, wp.lat];
    this.paintHalo();
    if (timeoutMs !== undefined) {
      this.haloTimer = setTimeout(() => this.clearHalo(), timeoutMs);
    }
  }

  /** Put the halo back after a style rebuild dropped its layers. */
  private restoreHalo(): void {
    if (this.haloAt) this.paintHalo();
  }

  private paintHalo(): void {
    if (!this.haloAt) return;
    // Under the markers when they're there. addLayer rejects a beforeId that
    // isn't in the style, so mid-rebuild the halo goes on top rather than
    // taking the call down with it.
    const beforeId = this.map.getLayer(POINTS_LAYER) ? POINTS_LAYER : undefined;
    this.halo.highlightPoints([this.haloAt], beforeId);
  }

  private clearHalo(): void {
    if (this.haloTimer) clearTimeout(this.haloTimer);
    this.haloTimer = null;
    this.haloAt = null;
    this.halo.clear();
  }

  private updateSource(): void {
    const source = this.map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;
    source.setData(this.buildGeoJSON());
  }

  private buildGeoJSON(): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];
    // `index` addresses this.waypoints, which DraggablePoints indexes into on
    // drop — so hidden waypoints are skipped without renumbering the rest.
    // Dropping them from the source also takes them out of hitTest and
    // dragging, which both go through queryRenderedFeatures.
    this.waypoints.forEach((wp, i) => {
      if (!wp.visible) return;
      features.push({
        type: "Feature",
        properties: {
          id: wp.id,
          name: wp.name,
          // Resolved here, not in a style expression — see waypointIconImage.
          iconImage: waypointIconImage(wp.icon, wp.color),
          index: i,
        },
        geometry: {
          type: "Point",
          coordinates: [wp.lon, wp.lat],
        },
      });
    });
    return { type: "FeatureCollection", features };
  }

  destroy(): void {
    this.draggable?.destroy();
    this.clearHalo();
  }
}
