/**
 * Renders GPS tracks on the map as GeoJSON line layers.
 * Active track updates live; completed tracks loaded from IndexedDB on demand.
 */

import type maplibregl from "maplibre-gl";
import { getAllTrackMetas, getTrackPoints } from "../data/db";
import type { TrackMeta, TrackPoint } from "../data/Track";
import type { NavigationData } from "../navigation/NavigationData";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import { lightenHex } from "../utils/color";
import { fitMapToBoundsIfNeeded } from "./fit-bounds";
import {
  GLOW_BLUR,
  GLOW_LIGHTEN,
  GLOW_OPACITY,
  GLOW_WIDTH,
} from "./selection-glow";
import type { TrackRecorder } from "./TrackRecorder";

/** Display point with timestamp for the active track buffer. */
interface DisplayPoint {
  lon: number;
  lat: number;
  timestamp: number;
}

/** Minimum interval between display buffer points (ms). */
const DISPLAY_INTERVAL_MS = 5000;

/** Max points in display buffer before the oldest are dropped. */
const MAX_DISPLAY_POINTS = 6000;

function sourceId(trackId: string): string {
  return `_track-${trackId}`;
}

function layerId(trackId: string): string {
  return `_track-line-${trackId}`;
}

export class TrackLayer {
  private readonly map: maplibregl.Map;
  private readonly recorder: TrackRecorder;
  private loadedTracks = new Map<string, TrackMeta>();
  private activePoints: DisplayPoint[] = [];
  private lastDisplayTime = 0;

  constructor(
    map: maplibregl.Map,
    navManager: NavigationDataManager,
    recorder: TrackRecorder,
  ) {
    this.map = map;
    this.recorder = recorder;

    map.on("style.load", () => this.reloadAll());
    if (map.isStyleLoaded()) this.reloadAll();

    // Update active track on each GPS fix
    navManager.subscribe((data) => this.onNavData(data));

    // Reload when recording state changes (new track started/stopped)
    recorder.onRecordingChange(() => {
      if (!recorder.isRecording()) {
        // Save final state and reload
        this.activePoints = [];
        this.lastDisplayTime = 0;
        this.reloadAll();
      }
    });
  }

  async reloadAll(): Promise<void> {
    // Remove old track layers
    for (const [id] of this.loadedTracks) {
      this.removeTrackLayer(id);
    }
    this.loadedTracks.clear();

    const metas = await getAllTrackMetas();
    for (const meta of metas) {
      if (meta.visible) {
        await this.loadTrack(meta);
      }
      this.loadedTracks.set(meta.id, meta);
    }

    // Restore selection halo after style reload
    if (this.selectedTrackId) {
      const sel = this.loadedTracks.get(this.selectedTrackId);
      if (sel) await this.selectTrack(sel);
      else this.selectedTrackId = null;
    }
  }

  async toggleTrackVisibility(id: string, visible: boolean): Promise<void> {
    const meta = this.loadedTracks.get(id);
    if (!meta) return;
    meta.visible = visible;
    if (visible) {
      await this.loadTrack(meta);
    } else {
      this.removeTrackLayer(id);
    }
  }

  private async loadTrack(meta: TrackMeta): Promise<void> {
    const points = await getTrackPoints(meta.id);
    // Outliers from Stop-time post-processing are kept in IDB so we can
    // still see the raw fix in debug tooling, but they're hidden from
    // rendering — the polyline reads cleaner without them.
    const coords = points
      .filter((p: TrackPoint) => !p.dropped)
      .map((p: TrackPoint) => [p.lon, p.lat] as [number, number]);
    this.addTrackLine(meta.id, meta.color, coords);
  }

  private addTrackLine(
    id: string,
    color: string,
    coords: [number, number][],
  ): void {
    const sid = sourceId(id);
    const lid = layerId(id);

    if (this.map.getSource(sid)) {
      const src = this.map.getSource(sid) as maplibregl.GeoJSONSource;
      src.setData(this.lineGeoJSON(coords));
      return;
    }

    this.map.addSource(sid, {
      type: "geojson",
      data: this.lineGeoJSON(coords),
      // Render the track faithfully — MapLibre's default 0.375 tile-space
      // simplification decimates a track sitting in a small area down to a
      // handful of points. We keep our own (already sparse) buffer instead.
      tolerance: 0,
    });

    this.map.addLayer({
      id: lid,
      type: "line",
      source: sid,
      paint: {
        "line-color": color,
        "line-width": 2.5,
        "line-opacity": 0.8,
      },
    });
  }

  private removeTrackLayer(id: string): void {
    const lid = layerId(id);
    const sid = sourceId(id);
    if (this.map.getLayer(lid)) this.map.removeLayer(lid);
    if (this.map.getSource(sid)) this.map.removeSource(sid);
  }

  // ── Track selection halo ────────────────────────────────────────────

  private static readonly SELECTED_SOURCE = "_track-selected-src";
  private static readonly SELECTED_LAYER = "_track-selected-glow";
  private selectedTrackId: string | null = null;

  /** Draw a soft blur halo around the given track's stored points. */
  async selectTrack(meta: TrackMeta): Promise<void> {
    this.selectedTrackId = meta.id;
    const points = await getTrackPoints(meta.id);
    if (this.selectedTrackId !== meta.id) return; // raced against another select
    const coords = points
      .filter((p: TrackPoint) => !p.dropped)
      .map((p: TrackPoint) => [p.lon, p.lat] as [number, number]);
    if (coords.length < 2) {
      this.clearSelectedTrack();
      return;
    }
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: coords },
        },
      ],
    };

    const glowColor = lightenHex(meta.color, GLOW_LIGHTEN);
    const src = this.map.getSource(TrackLayer.SELECTED_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (src) {
      src.setData(data);
      if (this.map.getLayer(TrackLayer.SELECTED_LAYER)) {
        this.map.setPaintProperty(
          TrackLayer.SELECTED_LAYER,
          "line-color",
          glowColor,
        );
      }
      return;
    }

    this.map.addSource(TrackLayer.SELECTED_SOURCE, {
      type: "geojson",
      data,
    });

    const beforeId = this.firstTrackLineLayer();
    this.map.addLayer(
      {
        id: TrackLayer.SELECTED_LAYER,
        type: "line",
        source: TrackLayer.SELECTED_SOURCE,
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
  }

  clearSelectedTrack(): void {
    this.selectedTrackId = null;
    const src = this.map.getSource(TrackLayer.SELECTED_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (src) {
      src.setData({ type: "FeatureCollection", features: [] });
    }
  }

  /** Zoom to fit the track, unless it's already well-framed on screen. */
  async fitTrack(meta: TrackMeta): Promise<void> {
    const allPoints = await getTrackPoints(meta.id);
    // Use only the points the user actually sees on the map.
    const points = allPoints.filter((p) => !p.dropped);
    if (points.length === 0) return;
    let minLon = points[0].lon;
    let minLat = points[0].lat;
    let maxLon = points[0].lon;
    let maxLat = points[0].lat;
    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      if (p.lon < minLon) minLon = p.lon;
      else if (p.lon > maxLon) maxLon = p.lon;
      if (p.lat < minLat) minLat = p.lat;
      else if (p.lat > maxLat) maxLat = p.lat;
    }
    fitMapToBoundsIfNeeded(this.map, [
      [minLon, minLat],
      [maxLon, maxLat],
    ]);
  }

  private firstTrackLineLayer(): string | undefined {
    for (const layer of this.map.getStyle().layers) {
      if (layer.id.startsWith("_track-line-")) return layer.id;
    }
    return undefined;
  }

  private onNavData(data: NavigationData): void {
    if (!this.recorder.isRecording()) return;
    const track = this.recorder.getCurrentTrack();
    if (!track) return;

    const now = data.timestamp;

    // Throttle display buffer to 5-second intervals
    if (now - this.lastDisplayTime < DISPLAY_INTERVAL_MS) return;

    // Skip if barely moved (matches recorder's 5m threshold to avoid
    // drawing jittery lines when stationary)
    if (this.activePoints.length > 0) {
      const last = this.activePoints[this.activePoints.length - 1];
      const dLat = data.latitude - last.lat;
      const dLon = data.longitude - last.lon;
      const cosLat = Math.cos((data.latitude * Math.PI) / 180);
      const distM = Math.sqrt(
        (dLat * 111_111) ** 2 + (dLon * 111_111 * cosLat) ** 2,
      );
      if (distM < 5) return;
    }

    this.lastDisplayTime = now;

    this.activePoints.push({
      lon: data.longitude,
      lat: data.latitude,
      timestamp: now,
    });

    // Memory bound only — drop oldest points past the cap. No live
    // simplification: the buffer is already sparse (≤1 point / 5 s) and a
    // modern device renders thousands of line vertices without trouble.
    while (this.activePoints.length > MAX_DISPLAY_POINTS) {
      this.activePoints.shift();
    }

    // Update or create the active track line
    const coords = this.activePoints.map(
      (p) => [p.lon, p.lat] as [number, number],
    );
    this.addTrackLine(track.id, track.color, coords);
  }

  private lineGeoJSON(coords: [number, number][]): GeoJSON.FeatureCollection {
    if (coords.length < 2) {
      return { type: "FeatureCollection", features: [] };
    }
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: coords },
        },
      ],
    };
  }
}
