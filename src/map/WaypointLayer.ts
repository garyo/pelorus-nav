/**
 * Renders standalone waypoints on the map with symbol + label layers.
 * Supports drag-to-move via DraggablePoints.
 */

import type maplibregl from "maplibre-gl";
import { getAllWaypoints, saveWaypoint } from "../data/db";
import type { StandaloneWaypoint } from "../data/Waypoint";
import { DraggablePoints } from "./DraggablePoints";
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

    if (this.map.getSource(SOURCE_ID)) return;

    this.map.addSource(SOURCE_ID, {
      type: "geojson",
      data: this.buildGeoJSON(),
    });

    ensurePointIcons(this.map);

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

    // Enable drag-to-move
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
        // Save to DB on drag end (debounced by DraggablePoints mouseup/touchend)
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
