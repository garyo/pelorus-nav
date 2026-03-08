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
  private activeCoords: [number, number][] = [];

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
        this.activeCoords = [];
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

    this.activeCoords.push([data.longitude, data.latitude]);

    // Update or create the active track line
    this.addTrackLine(track.id, track.color, this.activeCoords);
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
