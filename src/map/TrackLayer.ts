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
import { bboxOfCoords } from "../utils/coordinates";
import { fitMapToBoundsIfNeeded } from "./fit-bounds";
import { GLOW_LIGHTEN } from "./selection-glow";
import { SelectionHalo } from "./selection-halo";
import type { TrackRecorder } from "./TrackRecorder";

/** Display point with timestamp for the active track buffer. */
export interface DisplayPoint {
  lon: number;
  lat: number;
  timestamp: number;
}

/** Minimum interval between display buffer points (ms). */
const DISPLAY_INTERVAL_MS = 5000;

/** Max points in display buffer before the oldest are dropped. */
const MAX_DISPLAY_POINTS = 6000;

/**
 * Build the live-render buffer from a track's stored points, applying the
 * same memory bound as live recording. Pure — exported for testing.
 */
export function capDisplayPoints(
  points: TrackPoint[],
  max: number = MAX_DISPLAY_POINTS,
): DisplayPoint[] {
  const kept = points.filter((p) => !p.dropped);
  return kept.slice(-max).map((p) => ({
    lon: p.lon,
    lat: p.lat,
    timestamp: p.timestamp,
  }));
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
  /** Track id the live-render buffer currently represents. Used to detect a
   *  track change (new recording, resume, or a gap-split mid-recording) so
   *  the buffer can be reset instead of silently carrying over the previous
   *  track's points. */
  private currentTrackId: string | null = null;
  /** Track id a seedActivePoints() read is currently in flight for, so a
   *  second notification for the same track doesn't launch a duplicate
   *  IndexedDB read. */
  private seedingTrackId: string | null = null;
  private readonly selectionHalo: SelectionHalo;

  constructor(
    map: maplibregl.Map,
    navManager: NavigationDataManager,
    recorder: TrackRecorder,
  ) {
    this.map = map;
    this.recorder = recorder;
    this.selectionHalo = new SelectionHalo(map, {
      source: TrackLayer.SELECTED_SOURCE,
      lineLayer: TrackLayer.SELECTED_LAYER,
    });

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
        this.currentTrackId = null;
        this.reloadAll();
        return;
      }
      const track = recorder.getCurrentTrack();
      if (track) this.ensureTrackBuffer(track.id);
    });
  }

  /**
   * Reset the live-render buffer when the recorder's current track changes
   * (fresh start, resume after refresh, or a gap-split mid-recording) and
   * seed it from IndexedDB. A no-op when the buffer already belongs to
   * `trackId` — this is called on every GPS fix and every recorder notify,
   * so it must be cheap in the common case.
   */
  private ensureTrackBuffer(trackId: string): void {
    if (trackId === this.currentTrackId) return;
    this.currentTrackId = trackId;
    this.activePoints = [];
    this.lastDisplayTime = 0;
    this.seedActivePoints(trackId).catch(console.error);
  }

  /**
   * Seed the live-render buffer from IndexedDB — used when resuming a
   * recording after a page refresh and right after a gap-split mints a new
   * track. Guarded against duplicate concurrent reads for the same track
   * (seedingTrackId) and merges rather than overwrites on completion: a
   * live fix appended via onNavData while this read is in flight must
   * survive, not be discarded by the (now stale) IndexedDB snapshot.
   */
  private async seedActivePoints(trackId: string): Promise<void> {
    if (this.seedingTrackId === trackId) return;
    this.seedingTrackId = trackId;
    try {
      const points = await getTrackPoints(trackId);
      if (this.currentTrackId !== trackId) return; // superseded while reading
      const seeded = capDisplayPoints(points);
      const seededLast = seeded.length > 0 ? seeded[seeded.length - 1] : null;
      const liveOnly = seededLast
        ? this.activePoints.filter((p) => p.timestamp > seededLast.timestamp)
        : this.activePoints;
      this.activePoints = [...seeded, ...liveOnly].slice(-MAX_DISPLAY_POINTS);
      if (this.activePoints.length > 0) {
        this.lastDisplayTime =
          this.activePoints[this.activePoints.length - 1].timestamp;
      }
      // Render immediately — a resumed/split track otherwise stays blank
      // (or shows only a stray live point) until the next GPS fix arrives.
      const track = this.recorder.getCurrentTrack();
      if (track && track.id === trackId) {
        const coords = this.activePoints.map(
          (p) => [p.lon, p.lat] as [number, number],
        );
        this.addTrackLine(trackId, track.color, coords);
      }
    } finally {
      if (this.seedingTrackId === trackId) this.seedingTrackId = null;
    }
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

    const glowColor = lightenHex(meta.color, GLOW_LIGHTEN);
    this.selectionHalo.update(coords, glowColor, this.firstTrackLineLayer());
  }

  clearSelectedTrack(): void {
    this.selectedTrackId = null;
    this.selectionHalo.clear();
  }

  /** Zoom to fit the track, unless it's already well-framed on screen. */
  async fitTrack(meta: TrackMeta): Promise<void> {
    const allPoints = await getTrackPoints(meta.id);
    // Use only the points the user actually sees on the map.
    const points = allPoints.filter((p) => !p.dropped);
    const bbox = bboxOfCoords(points.map((p) => [p.lon, p.lat]));
    if (!bbox) return;
    fitMapToBoundsIfNeeded(this.map, [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[3]],
    ]);
  }

  private firstTrackLineLayer(): string | undefined {
    // getStyle() is undefined mid style-(re)load (theme / region swap); treat as
    // "no layer" — the reorder re-runs on style.load once the style is back.
    const style = this.map.getStyle();
    if (!style) return undefined;
    for (const layer of style.layers) {
      if (layer.id.startsWith("_track-line-")) return layer.id;
    }
    return undefined;
  }

  private onNavData(data: NavigationData): void {
    if (!this.recorder.isRecording()) return;
    const track = this.recorder.getCurrentTrack();
    if (!track) return;
    this.ensureTrackBuffer(track.id);

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
