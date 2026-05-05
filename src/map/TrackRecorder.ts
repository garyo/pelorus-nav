/**
 * Records GPS track data to IndexedDB.
 * Subscribes to NavigationDataManager, throttles to 1pt/sec,
 * and skips points < 5m from the last recorded point.
 *
 * Survives page refresh: persists the active track ID in localStorage.
 * On start(), resumes appending to the previous track if it's recent enough
 * (within GAP_THRESHOLD_MS). Otherwise starts a new track.
 * Track meta is not saved until the first point arrives (avoids zero-point tracks).
 */

import { Capacitor } from "@capacitor/core";
import { appendTrackPoint, getTrackPoints, saveTrackMeta } from "../data/db";
import type { TrackMeta, TrackPoint } from "../data/Track";
import type { NavigationData } from "../navigation/NavigationData";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import { BackgroundGPS } from "../plugins/BackgroundGPS";
import { haversineDistanceNM } from "../utils/coordinates";
import { generateUUID } from "../utils/uuid";

const MIN_INTERVAL_MS = 1000;
const MIN_MOVE_NM = 5 / 1852; // 5 meters in NM
const GAP_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const ACTIVE_TRACK_KEY = "pelorus-nav-active-track";

/** Format a Date as "YYYY-MM-DD HH:MM" in local time. */
function localDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type RecorderListener = () => void;

export class TrackRecorder {
  private readonly navManager: NavigationDataManager;
  private recording = false;
  private currentTrack: TrackMeta | null = null;
  /** True once the first point has been saved (and meta persisted). */
  private trackPersisted = false;
  private lastRecordedTime = 0;
  private lastLat = 0;
  private lastLon = 0;
  private listeners: RecorderListener[] = [];
  private navCallback: ((data: NavigationData) => void) | null = null;
  /**
   * In-flight tryResumeTrack(). onNavData and recoverBackgroundPoints
   * await this before touching currentTrack — without it, a GPS fix or
   * visibility-change arriving during the resume's IDB lookup creates a
   * new track that resume then overwrites, leaving an orphan zero-point
   * meta in IDB.
   */
  private resumePromise: Promise<void> | null = null;

  constructor(navManager: NavigationDataManager) {
    this.navManager = navManager;

    // Recover background GPS points when app returns to foreground
    if (Capacitor.isNativePlatform()) {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && this.recording) {
          this.recoverBackgroundPoints().catch(console.error);
        }
      });
    }
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
    this.resumePromise = this.tryResumeTrack();
    this.resumePromise.catch(console.error);
    this.navCallback = (data) => {
      this.onNavData(data).catch(console.error);
    };
    this.navManager.subscribe(this.navCallback);
    this.updateNativeNotification("Recording track");
    this.notify();
  }

  stop(): void {
    if (!this.recording) return;
    this.recording = false;
    if (this.navCallback) {
      this.navManager.unsubscribe(this.navCallback);
      this.navCallback = null;
    }
    // Save final point count if track was persisted
    if (this.currentTrack && this.trackPersisted) {
      saveTrackMeta(this.currentTrack).catch(console.error);
    }
    this.currentTrack = null;
    this.trackPersisted = false;
    this.lastRecordedTime = 0;
    this.resumePromise = null;
    localStorage.removeItem(ACTIVE_TRACK_KEY);
    this.updateNativeNotification("Navigating");
    this.notify();
  }

  private updateNativeNotification(text: string): void {
    if (!Capacitor.isNativePlatform()) return;
    BackgroundGPS.setNotificationText({ text }).catch(console.error);
  }

  onRecordingChange(fn: RecorderListener): void {
    this.listeners.push(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  /**
   * Try to resume the previously active track after a page refresh.
   * Loads the last point's timestamp; if within GAP_THRESHOLD_MS, resumes.
   */
  private async tryResumeTrack(): Promise<void> {
    const saved = localStorage.getItem(ACTIVE_TRACK_KEY);
    if (!saved) return;

    try {
      const meta = JSON.parse(saved) as TrackMeta;
      // Load last recorded point to check timing
      const points = await getTrackPoints(meta.id);
      if (points.length === 0) return; // zero-point track, don't resume

      const lastPoint = points[points.length - 1];
      const elapsed = Date.now() - lastPoint.timestamp;
      if (elapsed > GAP_THRESHOLD_MS) return; // too old, start fresh

      // Defensive: if onNavData/recovery already created a track (they
      // should now await resumePromise so this shouldn't fire), don't
      // clobber it.
      if (this.currentTrack) return;

      // Resume this track
      this.currentTrack = { ...meta, pointCount: points.length };
      this.trackPersisted = true;
      this.lastRecordedTime = lastPoint.timestamp;
      this.lastLat = lastPoint.lat;
      this.lastLon = lastPoint.lon;
    } catch {
      // Corrupt localStorage entry — ignore
      localStorage.removeItem(ACTIVE_TRACK_KEY);
    }
  }

  /**
   * Pull GPS points recorded by the native foreground service while
   * the WebView was suspended. Inserts them into the active IndexedDB track.
   */
  async recoverBackgroundPoints(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    // Wait for any in-flight tryResumeTrack — without this, recovery could
    // create a fresh track that resume then overwrites.
    if (this.resumePromise) await this.resumePromise;

    const { points } = await BackgroundGPS.getRecordedPoints();
    if (points.length === 0) return;

    // Filter to only points newer than what we've already recorded.
    const newPoints = points.filter(
      (pt) => pt.timestamp > this.lastRecordedTime,
    );
    if (newPoints.length === 0) {
      await BackgroundGPS.clearRecordedPoints();
      return;
    }

    // Ensure we have an active track
    if (!this.currentTrack) {
      const now = newPoints[0].timestamp;
      const date = new Date(now);
      const name = `Track ${localDateTime(date)}`;
      this.currentTrack = {
        id: generateUUID(),
        name,
        createdAt: now,
        color: "#ff4444",
        visible: true,
        pointCount: 0,
      };
      this.trackPersisted = false;
    }

    for (const pt of newPoints) {
      const trackPoint: TrackPoint = {
        lat: pt.lat,
        lon: pt.lon,
        timestamp: pt.timestamp,
        sog: pt.speed >= 0 ? pt.speed * 1.94384 : null, // m/s → knots
        cog: pt.course >= 0 ? pt.course : null,
      };

      // Update state BEFORE awaiting append, so a concurrent onNavData
      // sees the updated lastRecordedTime and won't duplicate.
      this.lastRecordedTime = pt.timestamp;
      this.lastLat = pt.lat;
      this.lastLon = pt.lon;

      await appendTrackPoint(this.currentTrack.id, trackPoint);
      this.currentTrack.pointCount++;

      // Persist meta on first point (avoids zero-point track meta in IDB)
      if (!this.trackPersisted) {
        await saveTrackMeta(this.currentTrack);
        this.trackPersisted = true;
        this.notify();
      }
    }

    // Save updated meta and clear native buffer
    await saveTrackMeta(this.currentTrack);
    localStorage.setItem(ACTIVE_TRACK_KEY, JSON.stringify(this.currentTrack));
    await BackgroundGPS.clearRecordedPoints();
  }

  private async onNavData(data: NavigationData): Promise<void> {
    // Wait for any in-flight tryResumeTrack — without this, a fix arriving
    // during resume's IDB lookup would create a new track that resume
    // immediately overwrites, leaving an orphan zero-point meta.
    if (this.resumePromise) await this.resumePromise;

    const now = data.timestamp;

    // Check for time gap → start new track
    if (
      this.currentTrack &&
      this.lastRecordedTime > 0 &&
      now - this.lastRecordedTime > GAP_THRESHOLD_MS
    ) {
      // Save final state of old track before starting new one
      if (this.trackPersisted) {
        await saveTrackMeta(this.currentTrack);
      }
      this.currentTrack = null;
      this.trackPersisted = false;
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

    // Create new track if needed (but don't persist meta yet — see below)
    if (!this.currentTrack) {
      const date = new Date(now);
      const name = `Track ${localDateTime(date)}`;
      this.currentTrack = {
        id: generateUUID(),
        name,
        createdAt: now,
        color: "#ff4444",
        visible: true,
        pointCount: 0,
      };
      this.trackPersisted = false;
    }

    const point: TrackPoint = {
      lat: data.latitude,
      lon: data.longitude,
      timestamp: now,
      sog: data.sog,
      cog: data.cog,
    };

    // Update state BEFORE awaiting, so a concurrent recoverBackgroundPoints
    // sees the new lastRecordedTime and skips this same fix from SQLite.
    this.lastRecordedTime = now;
    this.lastLat = data.latitude;
    this.lastLon = data.longitude;

    await appendTrackPoint(this.currentTrack.id, point);
    this.currentTrack.pointCount++;

    // Persist meta only after the first point is in the store, so a meta
    // record always corresponds to ≥ 1 stored point.
    if (!this.trackPersisted) {
      await saveTrackMeta(this.currentTrack);
      this.trackPersisted = true;
    }
    this.notify();

    // Persist active track ID for resume-after-refresh
    localStorage.setItem(ACTIVE_TRACK_KEY, JSON.stringify(this.currentTrack));

    // Periodically save updated point count
    if (this.currentTrack.pointCount % 60 === 0) {
      await saveTrackMeta(this.currentTrack);
    }
  }
}
