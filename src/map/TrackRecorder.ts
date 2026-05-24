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
import {
  appendTrackPoint,
  deleteTrack,
  getTrackPoints,
  replaceTrackPoints,
  saveTrackMeta,
} from "../data/db";
import {
  computeTrackAggregates,
  isTrivialTrack,
  type TrackMeta,
  type TrackPoint,
} from "../data/Track";
import type { NavigationData } from "../navigation/NavigationData";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import { smoothTrack } from "../navigation/RTSmoother";
import { BackgroundGPS } from "../plugins/BackgroundGPS";
import { haversineDistanceNM } from "../utils/coordinates";
import { generateUUID } from "../utils/uuid";

const MIN_INTERVAL_MS = 1000;
const MIN_MOVE_NM = 5 / 1852; // 5 meters in NM
const GAP_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
/** Tracks shorter than this skip the Stop-time RTS post-processor —
 *  too few points for the smoother to add value. */
const MIN_POINTS_FOR_SMOOTHING = 20;
/**
 * Reject GPS fixes with accuracy worse than this (meters). On Android,
 * FusedLocationProvider can fall back to cell-tower / WiFi-derived
 * locations when the GPS chip is asleep or signal is poor; those fixes
 * arrive with accuracy in the hundreds of meters and are sometimes
 * kilometers off the true position. Real GPS fixes are typically <15 m
 * even in marginal conditions, so 30 m is a comfortable floor. Fixes
 * with no accuracy field are accepted (some sources don't report it).
 */
const MAX_ACCURACY_M = 30;
/**
 * Single-point glitch detector. When the GPS goes silent for a while
 * (reception loss in a marina, under a bridge, between buildings) and
 * then returns a fix far away from the last good one, that fix is often
 * wrong — the chip "refound itself" in the wrong spot. The next fix
 * usually returns to the real position. We reject the spurious one by
 * requiring that any implied speed above SUSPICIOUS_SPEED_KN must come
 * from a gap of at most MAX_GAP_FOR_HIGH_SPEED_MS.
 *
 * Tuned conservatively: a real sport boat at 25 kn with a 30 s gap
 * (its fixes were arriving fine) is *not* rejected. A 4 kn sailboat
 * with a 79 s gap and a 17 kn implied speed *is* — the matching
 * real-world incident: Track 2026-05-22 13_14.gpx, idx 2760.
 */
const MAX_GAP_FOR_HIGH_SPEED_MS = 30_000;
const SUSPICIOUS_SPEED_KN = 15;
const ACTIVE_TRACK_KEY = "pelorus-nav-active-track";

/**
 * Returns true if the new fix (relative to the last accepted fix and its
 * timestamp) looks like a single-point GPS glitch and should be skipped.
 * Pure — exported for testing.
 */
export function isGapGlitch(
  prevLat: number,
  prevLon: number,
  prevTimestampMs: number,
  newLat: number,
  newLon: number,
  newTimestampMs: number,
  maxGapMs = MAX_GAP_FOR_HIGH_SPEED_MS,
  maxSpeedKn = SUSPICIOUS_SPEED_KN,
): boolean {
  const dtMs = newTimestampMs - prevTimestampMs;
  if (dtMs <= maxGapMs) return false;
  const distNM = haversineDistanceNM(prevLat, prevLon, newLat, newLon);
  const speedKn = (distNM * 3600 * 1000) / dtMs;
  return speedKn > maxSpeedKn;
}

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
   * In-flight tryResumeTrack(). onNavData awaits this before touching
   * currentTrack — without it, a GPS fix arriving during the resume's IDB
   * lookup creates a new track that resume then overwrites, leaving an
   * orphan zero-point meta in IDB.
   */
  private resumePromise: Promise<void> | null = null;

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
    // Snapshot the meta so the post-processor can run after we clear
    // the recording state — saves UI latency by not blocking the Stop.
    const closingTrack =
      this.currentTrack && this.trackPersisted ? this.currentTrack : null;
    // Drop trivially short tracks (1-2 points, <5 sec, or essentially
    // no movement) — almost always an accidental Record→Stop, not real
    // data. Saves the user from a manager full of "0 sec · 0.0 nm" rows.
    const trivial = closingTrack !== null && isTrivialTrack(closingTrack);
    if (closingTrack && !trivial) {
      saveTrackMeta(closingTrack).catch(console.error);
    } else if (closingTrack && trivial) {
      deleteTrack(closingTrack.id).catch(console.error);
    }
    this.currentTrack = null;
    this.trackPersisted = false;
    this.lastRecordedTime = 0;
    this.resumePromise = null;
    localStorage.removeItem(ACTIVE_TRACK_KEY);
    this.updateNativeNotification("Navigating");
    this.notify();

    if (
      closingTrack &&
      !trivial &&
      closingTrack.pointCount >= MIN_POINTS_FOR_SMOOTHING
    ) {
      this.postProcessTrack(closingTrack).catch(console.error);
    }
  }

  /**
   * One-shot RTS smoother + outlier rejection on a closed track. Loads
   * all points, smooths them with full past+future context, marks
   * outliers as `dropped`, preserves the originals as `rawLat/rawLon`,
   * writes the result back, and updates the meta. Runs in the
   * background after stop() returns; the panel re-renders via notify()
   * when complete.
   */
  private async postProcessTrack(meta: TrackMeta): Promise<void> {
    const points = await getTrackPoints(meta.id);
    if (points.length < MIN_POINTS_FOR_SMOOTHING) return;

    const result = smoothTrack(points);
    const outlierSet = new Set(result.outliers);

    const newPoints: TrackPoint[] = points.map((raw, i) => {
      const sm = result.smoothed[i];
      const isOutlier = outlierSet.has(i);
      return {
        lat: isOutlier ? raw.lat : sm.lat,
        lon: isOutlier ? raw.lon : sm.lon,
        timestamp: raw.timestamp,
        sog: isOutlier ? raw.sog : sm.sog,
        cog: isOutlier ? raw.cog : sm.cog,
        accuracy: raw.accuracy,
        rawLat: raw.lat,
        rawLon: raw.lon,
        ...(isOutlier ? { dropped: true } : {}),
      };
    });

    await replaceTrackPoints(meta.id, newPoints);
    const { durationMs, totalDistanceNM } = computeTrackAggregates(newPoints);
    await saveTrackMeta({
      ...meta,
      smoothed: true,
      pointCount: newPoints.length,
      durationMs,
      totalDistanceNM,
    });
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

  private async onNavData(data: NavigationData): Promise<void> {
    // Wait for any in-flight tryResumeTrack — without this, a fix arriving
    // during resume's IDB lookup would create a new track that resume
    // immediately overwrites, leaving an orphan zero-point meta.
    if (this.resumePromise) await this.resumePromise;

    // Reject low-quality fixes outright. These are mostly cell-tower /
    // WiFi-derived positions that FLP returns when the GPS chip is asleep;
    // they corrupt the track without any salvageable signal.
    if (data.accuracy !== null && data.accuracy > MAX_ACCURACY_M) {
      return;
    }

    const now = data.timestamp;

    // Single-point glitch reject: gap + implausibly high implied speed
    // signals a "GPS came back online in the wrong place" fix. Drop it;
    // we leave lastLat/lastLon/lastRecordedTime untouched so the *next*
    // good fix is compared against the previous good fix, not the glitch.
    if (
      this.lastRecordedTime > 0 &&
      isGapGlitch(
        this.lastLat,
        this.lastLon,
        this.lastRecordedTime,
        data.latitude,
        data.longitude,
        now,
      )
    ) {
      return;
    }

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

    // Distance from the previous accepted fix — used both to skip
    // anchor-noise points (MIN_MOVE_NM) and to accumulate the running
    // total distance below. Compute once.
    const isFirstPoint = this.lastRecordedTime === 0;
    const segmentNM = isFirstPoint
      ? 0
      : haversineDistanceNM(
          this.lastLat,
          this.lastLon,
          data.latitude,
          data.longitude,
        );
    if (!isFirstPoint && segmentNM < MIN_MOVE_NM) return;

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
        durationMs: 0,
        totalDistanceNM: 0,
      };
      this.trackPersisted = false;
    }

    const point: TrackPoint = {
      lat: data.latitude,
      lon: data.longitude,
      timestamp: now,
      sog: data.sog,
      cog: data.cog,
      accuracy: data.accuracy,
    };

    // Incremental track aggregates so the panel can show "X min · Y nm"
    // without rescanning every point. createdAt is the first point's
    // timestamp (preserved across resume), so `now − createdAt` is the
    // full recording span.
    if (segmentNM > 0) {
      this.currentTrack.totalDistanceNM =
        (this.currentTrack.totalDistanceNM ?? 0) + segmentNM;
      // ↑ ?? guard for resume-from-localStorage of a legacy track
      //   whose persisted meta predates these fields.
    }
    this.currentTrack.durationMs = Math.max(
      0,
      now - this.currentTrack.createdAt,
    );

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
