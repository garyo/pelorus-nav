/**
 * Pure analysis helpers for the track viewer: per-point speeds and
 * cumulative distances, cursor interpolation along the track, and the
 * speed→color mapping used by both the map gradient and the panel legend.
 *
 * All functions are pure and operate on time-sorted, non-dropped points.
 */

import {
  bearingDelta,
  haversineDistanceNM,
  initialBearingDeg,
} from "../utils/coordinates";
import type { TrackPoint } from "./Track";

const MS_PER_HOUR = 3_600_000;

export interface TrackAnalysis {
  /** Usable points: `dropped` excluded, sorted by timestamp. */
  points: TrackPoint[];
  /** Per-point timestamps (ms), for binary search while scrubbing. */
  times: Float64Array;
  /** Cumulative over-ground distance at each point, NM. */
  cumulativeNM: Float64Array;
  /** Speed at each point in knots — recorded SOG, or derived from fixes. */
  speedsKn: Float64Array;
  /** Course at each point — recorded COG, or the outgoing segment bearing. */
  coursesDeg: Float64Array;
  totalNM: number;
  durationMs: number;
  startTime: number;
  endTime: number;
  /** False for imports without timestamps — scrub by distance instead. */
  hasTime: boolean;
  maxSpeedKn: number;
  /** Overall average: distance over elapsed time (0 when no time data). */
  avgSpeedKn: number;
  /** Robust color-ramp bounds (≈5th–95th percentile of speeds). */
  rampMinKn: number;
  rampMaxKn: number;
}

/** Interpolated state at a cursor position along the track. */
export interface TrackCursor {
  lat: number;
  lon: number;
  /** Interpolated COG, or the segment bearing when COG wasn't recorded. */
  cogDeg: number;
  sogKn: number;
  distanceNM: number;
  timestamp: number;
  /** Index of the point at or before the cursor. */
  index: number;
}

/**
 * Analyze a track's points for viewing. Returns null when there are
 * fewer than two usable points (nothing to scrub along).
 */
export function analyzeTrack(allPoints: TrackPoint[]): TrackAnalysis | null {
  const points = allPoints
    .filter((p) => !p.dropped)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (points.length < 2) return null;

  const n = points.length;
  const times = Float64Array.from(points, (p) => p.timestamp);
  const cumulativeNM = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const a = points[i - 1];
    const b = points[i];
    cumulativeNM[i] =
      cumulativeNM[i - 1] + haversineDistanceNM(a.lat, a.lon, b.lat, b.lon);
  }
  const totalNM = cumulativeNM[n - 1];

  const startTime = points[0].timestamp;
  const endTime = points[n - 1].timestamp;
  const durationMs = endTime - startTime;
  // GPX imports without <time> elements parse as timestamp 0.
  const hasTime = startTime > 0 && durationMs > 0;

  const speedsKn = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const sog = points[i].sog;
    if (sog !== null && sog !== undefined && Number.isFinite(sog)) {
      speedsKn[i] = Math.max(0, sog);
    } else if (hasTime) {
      // Derive from the adjacent fix (backward diff; forward for the first)
      const j = i === 0 ? 1 : i;
      const dtH = (points[j].timestamp - points[j - 1].timestamp) / MS_PER_HOUR;
      speedsKn[i] = dtH > 0 ? (cumulativeNM[j] - cumulativeNM[j - 1]) / dtH : 0;
    }
  }

  const coursesDeg = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const cog = points[i].cog;
    if (cog !== null && cog !== undefined && Number.isFinite(cog)) {
      coursesDeg[i] = ((cog % 360) + 360) % 360;
    } else {
      const j = i === n - 1 ? i - 1 : i; // outgoing segment; incoming for last
      const p = points[j];
      const q = points[j + 1];
      coursesDeg[i] =
        p.lat === q.lat && p.lon === q.lon
          ? coursesDeg[Math.max(0, i - 1)]
          : initialBearingDeg(p.lat, p.lon, q.lat, q.lon);
    }
  }

  let maxSpeedKn = 0;
  for (const s of speedsKn) {
    if (s > maxSpeedKn) maxSpeedKn = s;
  }
  const avgSpeedKn = hasTime ? totalNM / (durationMs / MS_PER_HOUR) : 0;

  // Robust ramp bounds so a single GPS spike doesn't flatten the colors
  const sorted = Array.from(speedsKn).sort((a, b) => a - b);
  let rampMinKn = sorted[Math.floor(0.05 * (n - 1))];
  let rampMaxKn = sorted[Math.ceil(0.95 * (n - 1))];
  if (rampMaxKn - rampMinKn < 1) {
    // Near-constant speed — pad so the ramp stays meaningful
    const mid = (rampMinKn + rampMaxKn) / 2;
    rampMinKn = Math.max(0, mid - 0.5);
    rampMaxKn = mid + 0.5;
  }

  return {
    points,
    times,
    cumulativeNM,
    speedsKn,
    coursesDeg,
    totalNM,
    durationMs,
    startTime,
    endTime,
    hasTime,
    maxSpeedKn,
    avgSpeedKn,
    rampMinKn,
    rampMaxKn,
  };
}

/** Largest index i with values[i] <= x (values ascending). */
function lowerIndex(values: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = values.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (values[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function cursorAt(a: TrackAnalysis, i: number, t: number): TrackCursor {
  const p = a.points[i];
  const q = a.points[Math.min(i + 1, a.points.length - 1)];
  return {
    lat: p.lat + (q.lat - p.lat) * t,
    lon: p.lon + (q.lon - p.lon) * t,
    // The segment's course, held constant until the next fix: a position
    // mid-segment is travelling along it — blending toward the next
    // course made a route-preview boat crab sideways down long legs.
    cogDeg: a.coursesDeg[i],
    sogKn:
      a.speedsKn[i] +
      (a.speedsKn[Math.min(i + 1, a.points.length - 1)] - a.speedsKn[i]) * t,
    distanceNM:
      a.cumulativeNM[i] +
      (a.cumulativeNM[Math.min(i + 1, a.points.length - 1)] -
        a.cumulativeNM[i]) *
        t,
    timestamp: p.timestamp + (q.timestamp - p.timestamp) * t,
    index: i,
  };
}

/** Interpolated cursor state at an absolute timestamp (clamped to track). */
export function cursorAtTime(a: TrackAnalysis, timestamp: number): TrackCursor {
  const t = Math.min(Math.max(timestamp, a.startTime), a.endTime);
  const i = Math.min(lowerIndex(a.times, t), a.points.length - 2);
  const span = a.times[i + 1] - a.times[i];
  return cursorAt(a, i, span > 0 ? (t - a.times[i]) / span : 0);
}

/**
 * Interpolated cursor state at a 0–1 fraction of the track — of elapsed
 * time when timestamps exist, else of distance (timestamp-less imports).
 */
export function cursorAtFraction(a: TrackAnalysis, frac: number): TrackCursor {
  const f = Math.min(Math.max(frac, 0), 1);
  if (a.hasTime) return cursorAtTime(a, a.startTime + f * a.durationMs);
  const d = f * a.totalNM;
  const i = Math.min(lowerIndex(a.cumulativeNM, d), a.points.length - 2);
  const span = a.cumulativeNM[i + 1] - a.cumulativeNM[i];
  return cursorAt(a, i, span > 0 ? (d - a.cumulativeNM[i]) / span : 0);
}

/** Stats for a selected span of the track (chart range-select). */
export interface RangeStats {
  start: TrackCursor;
  end: TrackCursor;
  distanceNM: number;
  durationMs: number;
  avgKn: number;
  maxKn: number;
}

/** Compute stats between two scrub fractions (order-insensitive). */
export function rangeStats(
  a: TrackAnalysis,
  fracA: number,
  fracB: number,
): RangeStats {
  const start = cursorAtFraction(a, Math.min(fracA, fracB));
  const end = cursorAtFraction(a, Math.max(fracA, fracB));
  const distanceNM = end.distanceNM - start.distanceNM;
  const durationMs = a.hasTime ? end.timestamp - start.timestamp : 0;
  let maxKn = Math.max(start.sogKn, end.sogKn);
  for (let i = start.index + 1; i <= end.index; i++) {
    if (a.speedsKn[i] > maxKn) maxKn = a.speedsKn[i];
  }
  return {
    start,
    end,
    distanceNM,
    durationMs,
    avgKn: durationMs > 0 ? distanceNM / (durationMs / MS_PER_HOUR) : 0,
    maxKn,
  };
}

// ── Stops & maneuvers ─────────────────────────────────────────────────

/** Below this speed the boat counts as stopped (anchored, moored, drifting). */
export const STOP_SPEED_KN = 0.3;
/** Slow intervals shorter than this aren't stops — just a luff or a lull. */
export const STOP_MIN_MS = 3 * 60_000;

/** A continuous stopped interval (anchored / moored). */
export interface StopInterval {
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  durationMs: number;
}

/**
 * Find stopped intervals: SOG below STOP_SPEED_KN for at least STOP_MIN_MS.
 * Requires timestamps; returns [] for timestamp-less imports.
 */
export function detectStops(a: TrackAnalysis): StopInterval[] {
  if (!a.hasTime) return [];
  const stops: StopInterval[] = [];
  const n = a.points.length;
  let runStart = -1;
  for (let i = 0; i <= n; i++) {
    const slow = i < n && a.speedsKn[i] < STOP_SPEED_KN;
    if (slow && runStart < 0) {
      runStart = i;
    } else if (!slow && runStart >= 0) {
      const startTime = a.times[runStart];
      const endTime = a.times[i - 1];
      if (endTime - startTime >= STOP_MIN_MS) {
        stops.push({
          startIndex: runStart,
          endIndex: i - 1,
          startTime,
          endTime,
          durationMs: endTime - startTime,
        });
      }
      runStart = -1;
    }
  }
  return stops;
}

/** Moving time and the average speed while moving. */
export function movingStats(
  a: TrackAnalysis,
  stops: StopInterval[],
): { movingMs: number; avgMovingKn: number } {
  const stoppedMs = stops.reduce((sum, s) => sum + s.durationMs, 0);
  const movingMs = Math.max(0, a.durationMs - stoppedMs);
  return {
    movingMs,
    avgMovingKn: movingMs > 0 ? a.totalNM / (movingMs / MS_PER_HOUR) : 0,
  };
}

/** Course must swing at least this far to count as a maneuver. */
export const MANEUVER_MIN_TURN_DEG = 60;
/** The swing must complete within this window. */
export const MANEUVER_WINDOW_MS = 45_000;
/** Ignore course noise while drifting/stopped. */
export const MANEUVER_MIN_SPEED_KN = 1;

/**
 * A sustained course change while under way — a tack, gybe, or rounding.
 * Deliberately NOT classified as tack vs gybe: without wind data that
 * call is wrong too often to be useful.
 */
export interface Maneuver {
  index: number;
  timestamp: number;
  lat: number;
  lon: number;
  /** Signed total turn over the window: + starboard, − port. */
  turnDeg: number;
}

/**
 * Find maneuvers: the course swings ≥ MANEUVER_MIN_TURN_DEG within
 * MANEUVER_WINDOW_MS while the boat is moving. After a hit, scanning
 * resumes past the window so one turn registers once. Requires
 * timestamps; returns [] for timestamp-less imports.
 */
export function detectManeuvers(a: TrackAnalysis): Maneuver[] {
  if (!a.hasTime) return [];
  const maneuvers: Maneuver[] = [];
  const n = a.points.length;
  let i = 0;
  let j = 0;
  while (i < n - 1) {
    // Advance j to the end of the window starting at i
    if (j < i) j = i;
    while (j + 1 < n && a.times[j + 1] - a.times[i] <= MANEUVER_WINDOW_MS) j++;
    // Sparse recording (adaptive GPS rate) can leave gaps longer than the
    // window; a big course change across the gap means the turn happened
    // inside it, so always compare at least adjacent fixes.
    if (j === i) j = i + 1;
    const turn = bearingDelta(a.coursesDeg[j], a.coursesDeg[i]);
    if (Math.abs(turn) >= MANEUVER_MIN_TURN_DEG) {
      let minKn = Number.POSITIVE_INFINITY;
      for (let k = i; k <= j; k++) {
        if (a.speedsKn[k] < minKn) minKn = a.speedsKn[k];
      }
      if (minKn >= MANEUVER_MIN_SPEED_KN) {
        // A slow tack is often still swinging at the window's edge;
        // absorb the rest of the same-direction rotation so the
        // residue can't re-trigger as a second maneuver.
        let end = j;
        let total = turn;
        while (end + 1 < n) {
          const d = bearingDelta(a.coursesDeg[end + 1], a.coursesDeg[end]);
          if (d * Math.sign(turn) <= 0) break;
          total += d;
          end++;
        }
        // Round up so a gap-spanning pair marks the turn's completion
        const mid = Math.min(i + Math.ceil((end - i) / 2), n - 1);
        // A slow tack can also overshoot the new course and steer back.
        // Absorb that contiguous counter-swing when it's smaller than
        // the turn itself — an equal-or-larger opposite swing is a real
        // second maneuver, and a steady leg (zero delta) ends absorption.
        let cEnd = end;
        let counter = 0;
        while (cEnd + 1 < n) {
          const d = bearingDelta(a.coursesDeg[cEnd + 1], a.coursesDeg[cEnd]);
          if (d * Math.sign(turn) >= 0) break;
          counter += d;
          cEnd++;
        }
        if (Math.abs(counter) < Math.abs(total)) {
          total += counter;
          end = cEnd;
        }
        maneuvers.push({
          index: mid,
          timestamp: a.times[mid],
          lat: a.points[mid].lat,
          lon: a.points[mid].lon,
          turnDeg: total,
        });
        i = end; // debounce: one event per turn
        continue;
      }
    }
    i++;
  }
  return maneuvers;
}

// ── Gradient colors ───────────────────────────────────────────────────

/** What drives the track's gradient color. */
export type TrackColorMode = "speed" | "course" | "time";

/**
 * Value color ramp: blue (low) → teal → yellow → red (high).
 * Chosen for contrast against both chart water blues and land buffs.
 */
const RAMP: Array<[number, [number, number, number]]> = [
  [0.0, [48, 86, 200]],
  [0.35, [31, 180, 135]],
  [0.7, [232, 210, 58]],
  [1.0, [224, 72, 48]],
];

/** Interpolate the ramp at fraction f (clamped to 0–1). */
export function rampColor(f: number): string {
  const fc = Math.min(Math.max(f, 0), 1);
  let i = 0;
  while (i < RAMP.length - 2 && fc > RAMP[i + 1][0]) i++;
  const [f0, c0] = RAMP[i];
  const [f1, c1] = RAMP[i + 1];
  const t = f1 > f0 ? (fc - f0) / (f1 - f0) : 0;
  const ch = (k: 0 | 1 | 2) => Math.round(c0[k] + (c1[k] - c0[k]) * t);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}

/** Map a speed to a ramp color given the analysis' ramp bounds. */
export function speedToColor(kn: number, minKn: number, maxKn: number): string {
  return rampColor((kn - minKn) / (maxKn - minKn));
}

/**
 * Cyclical course color — a hue wheel, so steady headings read as one
 * color and tacking legs alternate strongly.
 */
export function courseToColor(deg: number): string {
  const h = Math.round(((deg % 360) + 360) % 360);
  return `hsl(${h},65%,45%)`;
}

/**
 * Build [line-progress, color] stops for a MapLibre line-gradient.
 * Progress is the fraction of distance along the line. Downsamples to at
 * most `maxStops`; speed mode keeps each bin's fastest value so bursts
 * stay visible, course/time sample the bin midpoint. Stops are strictly
 * ascending as line-gradient requires.
 */
export function trackGradientStops(
  a: TrackAnalysis,
  mode: TrackColorMode = "speed",
  maxStops = 200,
): Array<[number, string]> {
  const colorAt = (binMaxKn: number, mid: number): string => {
    switch (mode) {
      case "speed":
        return speedToColor(binMaxKn, a.rampMinKn, a.rampMaxKn);
      case "course":
        return courseToColor(a.coursesDeg[mid]);
      case "time":
        return rampColor(
          a.durationMs > 0 ? (a.times[mid] - a.startTime) / a.durationMs : 0,
        );
    }
  };
  if (a.totalNM <= 0) {
    return [[0, colorAt(a.speedsKn[0], 0)]];
  }
  const n = a.points.length;
  const step = Math.max(1, Math.ceil(n / maxStops));
  const stops: Array<[number, string]> = [];
  let lastProgress = -1;
  for (let start = 0; start < n; start += step) {
    const end = Math.min(start + step, n);
    let maxKn = 0;
    for (let i = start; i < end; i++) {
      if (a.speedsKn[i] > maxKn) maxKn = a.speedsKn[i];
    }
    const mid = Math.min(start + ((end - start) >> 1), n - 1);
    const progress = a.cumulativeNM[mid] / a.totalNM;
    if (progress <= lastProgress) continue; // co-located fixes
    lastProgress = progress;
    stops.push([progress, colorAt(maxKn, mid)]);
  }
  return stops;
}
