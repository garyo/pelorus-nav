/**
 * Pure analysis helpers for the track viewer: per-point speeds and
 * cumulative distances, cursor interpolation along the track, and the
 * speed→color mapping used by both the map gradient and the panel legend.
 *
 * All functions are pure and operate on time-sorted, non-dropped points.
 */

import { haversineDistanceNM, initialBearingDeg } from "../utils/coordinates";
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

/** Interpolate a bearing through the shortest arc. */
function lerpBearing(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return (a + delta * t + 360) % 360;
}

function cursorAt(a: TrackAnalysis, i: number, t: number): TrackCursor {
  const p = a.points[i];
  const q = a.points[Math.min(i + 1, a.points.length - 1)];
  const cog =
    p.cog !== null &&
    p.cog !== undefined &&
    q.cog !== null &&
    q.cog !== undefined
      ? lerpBearing(p.cog, q.cog, t)
      : p === q
        ? (p.cog ?? 0)
        : initialBearingDeg(p.lat, p.lon, q.lat, q.lon);
  return {
    lat: p.lat + (q.lat - p.lat) * t,
    lon: p.lon + (q.lon - p.lon) * t,
    cogDeg: cog,
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

/**
 * Speed color ramp: blue (slow) → teal → yellow → red (fast).
 * Chosen for contrast against both chart water blues and land buffs.
 */
const RAMP: Array<[number, [number, number, number]]> = [
  [0.0, [48, 86, 200]],
  [0.35, [31, 180, 135]],
  [0.7, [232, 210, 58]],
  [1.0, [224, 72, 48]],
];

/** Map a speed to a ramp color given the analysis' ramp bounds. */
export function speedToColor(kn: number, minKn: number, maxKn: number): string {
  const f = Math.min(Math.max((kn - minKn) / (maxKn - minKn), 0), 1);
  let i = 0;
  while (i < RAMP.length - 2 && f > RAMP[i + 1][0]) i++;
  const [f0, c0] = RAMP[i];
  const [f1, c1] = RAMP[i + 1];
  const t = f1 > f0 ? (f - f0) / (f1 - f0) : 0;
  const ch = (k: 0 | 1 | 2) => Math.round(c0[k] + (c1[k] - c0[k]) * t);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}

/**
 * Build [line-progress, color] stops for a MapLibre line-gradient.
 * Progress is the fraction of distance along the line. Downsamples to at
 * most `maxStops`, keeping each bin's fastest speed so bursts stay visible.
 * Stops are strictly ascending as line-gradient requires.
 */
export function speedGradientStops(
  a: TrackAnalysis,
  maxStops = 200,
): Array<[number, string]> {
  if (a.totalNM <= 0) {
    return [[0, speedToColor(a.speedsKn[0], a.rampMinKn, a.rampMaxKn)]];
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
    // Place the stop at the bin's midpoint distance
    const mid = Math.min(start + ((end - start) >> 1), n - 1);
    const progress = a.cumulativeNM[mid] / a.totalNM;
    if (progress <= lastProgress) continue; // co-located fixes
    lastProgress = progress;
    stops.push([progress, speedToColor(maxKn, a.rampMinKn, a.rampMaxKn)]);
  }
  return stops;
}
