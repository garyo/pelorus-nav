/**
 * Renders GPS tracks on the map as GeoJSON line layers.
 * Active track updates live; completed tracks loaded from IndexedDB on demand.
 */

import type maplibregl from "maplibre-gl";
import { getAllTrackMetas, getTrackPoints } from "../data/db";
import type { TrackMeta, TrackPoint } from "../data/Track";
import type { NavigationData } from "../navigation/NavigationData";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import type { TrackRecorder } from "./TrackRecorder";

/** Display point with timestamp for the active track buffer. */
interface DisplayPoint {
  lon: number;
  lat: number;
  timestamp: number;
}

/** Minimum interval between display buffer points (ms). */
const DISPLAY_INTERVAL_MS = 5000;

/** Max points in display buffer before simplification is forced. */
const MAX_DISPLAY_POINTS = 6000;

/** How often to run line simplification (every N points added). */
const SIMPLIFY_EVERY = 50;

/**
 * Perpendicular distance from point C to line A→B, in approximate meters.
 * Uses equirectangular approximation (fine for short distances).
 */
function perpendicularDistMeters(
  a: DisplayPoint,
  b: DisplayPoint,
  c: DisplayPoint,
): number {
  const cosLat = Math.cos((c.lat * Math.PI) / 180);
  // Convert to approximate meters
  const ax = a.lon * cosLat;
  const ay = a.lat;
  const bx = b.lon * cosLat;
  const by = b.lat;
  const cx = c.lon * cosLat;
  const cy = c.lat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    // A and B are the same point
    const ex = cx - ax;
    const ey = cy - ay;
    return Math.sqrt(ex * ex + ey * ey) * 111_320;
  }

  // Project C onto line AB, clamp to segment
  const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / lenSq));
  const px = ax + t * dx;
  const py = ay + t * dy;
  const ex = cx - px;
  const ey = cy - py;
  return Math.sqrt(ex * ex + ey * ey) * 111_320; // degrees to meters
}

/**
 * In-place line simplification: removes interior points whose perpendicular
 * distance to the segment formed by their neighbors is below threshold.
 * Single pass, O(n). Preserves first and last points.
 */
function simplifyLine(points: DisplayPoint[], toleranceMeters: number): void {
  if (points.length <= 3) return;

  let write = 1; // index to write next kept point (0 is always kept)
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[write - 1]; // last kept point
    const b = points[i + 1]; // next point (always exists since i < length-1)
    const c = points[i]; // candidate

    if (perpendicularDistMeters(a, b, c) >= toleranceMeters) {
      points[write] = points[i];
      write++;
    }
  }
  // Keep last point
  points[write] = points[points.length - 1];
  points.length = write + 1;
}

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
  private addCounter = 0;

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
        this.addCounter = 0;
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
    const coords = points.map(
      (p: TrackPoint) => [p.lon, p.lat] as [number, number],
    );
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
    this.addCounter++;

    // Periodically simplify: remove near-collinear points (5m tolerance)
    if (this.addCounter % SIMPLIFY_EVERY === 0) {
      simplifyLine(this.activePoints, 5);
    }

    // Hard cap: drop oldest points if still over budget after simplification
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
