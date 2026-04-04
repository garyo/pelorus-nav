/**
 * Renders standalone waypoints on the map with symbol + label layers.
 * Supports drag-to-move via DraggablePoints.
 */

import type maplibregl from "maplibre-gl";
import { getAllWaypoints, saveWaypoint } from "../data/db";
import type { StandaloneWaypoint } from "../data/Waypoint";
import { DraggablePoints } from "./DraggablePoints";
import { onModeChange } from "./InteractionMode";
import { ensurePointIcons, WAYPOINT_ICON_EXPR } from "./point-icons";

const SOURCE_ID = "_waypoints";
const POINTS_LAYER = "_waypoints-points";
const LABELS_LAYER = "_waypoints-labels";

export class WaypointLayer {
  private readonly map: maplibregl.Map;
  private waypoints: StandaloneWaypoint[] = [];
  private draggable: DraggablePoints | null = null;

  constructor(map: maplibregl.Map) {
    this.map = map;
    map.on("style.load", () => this.setup());
    if (map.isStyleLoaded()) this.setup();

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

  async reloadAll(): Promise<void> {
    this.waypoints = await getAllWaypoints();
    this.updateSource();
  }

  async addWaypoint(wp: StandaloneWaypoint): Promise<void> {
    await saveWaypoint(wp);
    this.waypoints.push(wp);
    this.updateSource();
  }

  async removeWaypoint(id: string): Promise<void> {
    this.waypoints = this.waypoints.filter((w) => w.id !== id);
    this.updateSource();
  }

  async updateWaypoint(wp: StandaloneWaypoint): Promise<void> {
    await saveWaypoint(wp);
    const idx = this.waypoints.findIndex((w) => w.id === wp.id);
    if (idx >= 0) {
      this.waypoints[idx] = wp;
    }
    this.updateSource();
  }

  getWaypoints(): readonly StandaloneWaypoint[] {
    return this.waypoints;
  }

  private async setup(): Promise<void> {
    this.waypoints = await getAllWaypoints();

    // Always re-register canvas-drawn icons — they can be lost after
    // setStyle({ diff: true }) even when the source/layers persist.
    ensurePointIcons(this.map);

    if (this.map.getSource(SOURCE_ID)) {
      this.updateSource();
      return;
    }

    this.map.addSource(SOURCE_ID, {
      type: "geojson",
      data: this.buildGeoJSON(),
    });

    this.map.addLayer({
      id: POINTS_LAYER,
      type: "symbol",
      source: SOURCE_ID,
      layout: {
        "icon-image": WAYPOINT_ICON_EXPR,
        "icon-size": 0.85,
        "icon-allow-overlap": true,
      },
    });

    this.map.addLayer({
      id: LABELS_LAYER,
      type: "symbol",
      source: SOURCE_ID,
      layout: {
        "text-field": ["get", "name"],
        "text-size": 11,
        "text-offset": [0, -1.5],
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#fff",
        "text-halo-color": "rgba(0,0,0,0.7)",
        "text-halo-width": 1,
      },
    });

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
        this.updateSource();
        saveWaypoint(wp).catch(console.error);
      },
    );
  }

  private updateSource(): void {
    const source = this.map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;
    source.setData(this.buildGeoJSON());
  }

  private buildGeoJSON(): GeoJSON.FeatureCollection {
    return {
      type: "FeatureCollection",
      features: this.waypoints.map((wp, i) => ({
        type: "Feature" as const,
        properties: {
          id: wp.id,
          name: wp.name,
          icon: wp.icon,
          index: i,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [wp.lon, wp.lat],
        },
      })),
    };
  }

  destroy(): void {
    this.draggable?.destroy();
  }
}
