/**
 * Records GPS track data to IndexedDB.
 * Subscribes to NavigationDataManager, throttles to 1pt/sec,
 * and skips points < 5m from the last recorded point.
 */

import { appendTrackPoint, saveTrackMeta } from "../data/db";
import type { TrackMeta, TrackPoint } from "../data/Track";
import type { NavigationData } from "../navigation/NavigationData";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import { haversineDistanceNM } from "../utils/coordinates";

const MIN_INTERVAL_MS = 1000;
const MIN_MOVE_NM = 5 / 1852; // 5 meters in NM
const GAP_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

type RecorderListener = () => void;

export class TrackRecorder {
  private readonly navManager: NavigationDataManager;
  private recording = false;
  private currentTrack: TrackMeta | null = null;
  private lastRecordedTime = 0;
  private lastLat = 0;
  private lastLon = 0;
  private listeners: RecorderListener[] = [];
  private navCallback: ((data: NavigationData) => void) | null = null;

  constructor(navManager: NavigationDataManager) {
    this.navManager = navManager;
  }

  isRecording(): boolean {
    return this.recording;
  }

  getCurrentTrack(): TrackMeta | null {
    return this.currentTrack;
  }

  start(): void {
    if (this.recording) return;
    this.recording = true;
    this.navCallback = (data) => this.onNavData(data);
    this.navManager.subscribe(this.navCallback);
    this.notify();
  }

  stop(): void {
    if (!this.recording) return;
    this.recording = false;
    if (this.navCallback) {
      this.navManager.unsubscribe(this.navCallback);
      this.navCallback = null;
    }
    this.currentTrack = null;
    this.lastRecordedTime = 0;
    this.notify();
  }

  onRecordingChange(fn: RecorderListener): void {
    this.listeners.push(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private async onNavData(data: NavigationData): Promise<void> {
    const now = data.timestamp;

    // Check for time gap → start new track
    if (
      this.currentTrack &&
      this.lastRecordedTime > 0 &&
      now - this.lastRecordedTime > GAP_THRESHOLD_MS
    ) {
      this.currentTrack = null;
    }

    // Throttle: min 1 second between points
    if (now - this.lastRecordedTime < MIN_INTERVAL_MS) return;

    // Skip if barely moved (avoids bloat at anchor)
    if (this.lastRecordedTime > 0) {
      const dist = haversineDistanceNM(
        this.lastLat,
        this.lastLon,
        data.latitude,
        data.longitude,
      );
      if (dist < MIN_MOVE_NM) return;
    }

    // Create new track if needed
    if (!this.currentTrack) {
      const date = new Date(now);
      const name = `Track ${date.toISOString().slice(0, 16).replace("T", " ")}`;
      this.currentTrack = {
        id: crypto.randomUUID(),
        name,
        createdAt: now,
        color: "#ff4444",
        visible: true,
        pointCount: 0,
      };
      await saveTrackMeta(this.currentTrack);
      this.notify();
    }

    const point: TrackPoint = {
      lat: data.latitude,
      lon: data.longitude,
      timestamp: now,
      sog: data.sog,
      cog: data.cog,
    };

    await appendTrackPoint(this.currentTrack.id, point);
    this.currentTrack.pointCount++;
    this.lastRecordedTime = now;
    this.lastLat = data.latitude;
    this.lastLon = data.longitude;

    // Periodically save updated point count
    if (this.currentTrack.pointCount % 60 === 0) {
      await saveTrackMeta(this.currentTrack);
    }
  }
}
