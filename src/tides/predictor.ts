/**
 * Offline tide prediction from bundled NOAA harmonic constituents.
 *
 * Reference stations get a continuous height curve. Subordinate stations
 * get high/low events (reference extremes with NOAA time/height offsets
 * applied) plus an *approximate* instantaneous height interpolated between
 * those offset events — NOAA publishes no curve for them.
 */

import type { ExtremeOffsets } from "@neaps/tide-predictor";
import { isTideRef, type TideStation, type TidesIndex } from "./bundle";
import { getPredictor } from "./harmonics";
import type { TideSubStation } from "./schema";

export interface TideEvent {
  time: Date;
  type: "high" | "low";
  heightMeters: number;
}

export interface TideState {
  /** Instantaneous height (m MLLW); interpolated for subordinate stations. */
  heightMeters: number | null;
  /** True when the height is interpolated from offset events (subordinate). */
  approximate?: boolean;
  trend: "rising" | "falling";
  /** Upcoming highs/lows within the requested window, soonest first. */
  events: TideEvent[];
}

/** Sample spacing used to detect rising/falling at reference stations. */
const TREND_SAMPLE_MS = 10 * 60 * 1000;

const HOUR_MS = 3600 * 1000;

/** Half-window guaranteeing ≥2 bracketing extremes for interpolation. */
const SUB_WINDOW_MS = 13 * HOUR_MS;

export interface TideNow {
  /** Instantaneous height (m MLLW); interpolated for subordinate stations. */
  heightMeters: number | null;
  /** True when the height is interpolated from offset events (subordinate). */
  approximate?: boolean;
  trend: "rising" | "falling";
  /**
   * Position of the current height within this cycle's range:
   * 0 = at the surrounding low, 1 = at the surrounding high.
   */
  fraction: number | null;
}

function subOffsets(s: TideSubStation): ExtremeOffsets {
  return {
    time: { high: s.tHigh, low: s.tLow },
    height: {
      high: s.hHigh,
      low: s.hLow,
      type: s.hAdjType === "F" ? "fixed" : "ratio",
    },
  };
}

/** Cycle fraction of `level` within the extremes' range, clamped to 0..1. */
function cycleFraction(
  level: number,
  extremes: { level: number }[],
): number | null {
  if (extremes.length < 2) return null;
  const levels = extremes.map((e) => e.level);
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  if (hi <= lo) return null;
  return Math.min(1, Math.max(0, (level - lo) / (hi - lo)));
}

/**
 * Approximate now-state for a subordinate station: the library interpolates
 * a curve between the offset-adjusted extremes of the reference.
 * Returns null when the reference is missing or interpolation isn't possible.
 */
function subTideNow(
  station: TideSubStation,
  index: TidesIndex,
  at: Date,
): TideNow | null {
  const ref = index.tideRefById.get(station.refId);
  if (!ref) return null;
  const p = getPredictor(
    `t:${ref.id}`,
    index.bundle.constituents,
    ref.amp,
    ref.phase,
    ref.datum,
  );
  const start = new Date(at.getTime() - SUB_WINDOW_MS);
  const end = new Date(at.getTime() + SUB_WINDOW_MS);
  const offsets = subOffsets(station);
  try {
    const points = p.getTimelinePrediction({
      start,
      end,
      timeFidelity: 600,
      offsets,
    });
    if (points.length < 2) return null;
    // Nearest sample to `at`, and its successor for the trend
    let i = points.findIndex((pt) => pt.time.getTime() >= at.getTime());
    if (i < 0) i = points.length - 1;
    const level = points[i].level;
    const next = points[i + 1] ?? points[i - 1];
    const rising =
      points[i + 1] !== undefined ? next.level >= level : level >= next.level;
    const extremes = p.getExtremesPrediction({ start, end, offsets });
    return {
      heightMeters: level,
      approximate: true,
      trend: rising ? "rising" : "falling",
      fraction: cycleFraction(level, extremes),
    };
  } catch {
    // Interpolation needs ≥2 extremes in the window; fall back to events-only
    return null;
  }
}

/**
 * Lightweight now-state for map display: height, trend, and cycle fraction.
 */
export function tideNow(
  station: TideStation,
  index: TidesIndex,
  at: Date,
): TideNow | null {
  if (isTideRef(station)) {
    const p = getPredictor(
      `t:${station.id}`,
      index.bundle.constituents,
      station.amp,
      station.phase,
      station.datum,
    );
    const level = p.getWaterLevelAtTime({ time: at }).level;
    const soon = p.getWaterLevelAtTime({
      time: new Date(at.getTime() + TREND_SAMPLE_MS),
    }).level;
    // Cycle range from the extremes bracketing now (±12 h)
    const extremes = p.getExtremesPrediction({
      start: new Date(at.getTime() - 12 * HOUR_MS),
      end: new Date(at.getTime() + 12 * HOUR_MS),
    });
    return {
      heightMeters: level,
      trend: soon >= level ? "rising" : "falling",
      fraction: cycleFraction(level, extremes),
    };
  }
  const approx = subTideNow(station, index, at);
  if (approx) return approx;
  // Fallback: trend from the next offset event
  const state = tideState(station, index, at, 15);
  return state && { heightMeters: null, trend: state.trend, fraction: null };
}

/**
 * Predict the tide at `station` for time `at`.
 * Returns null if a subordinate's reference station is missing.
 */
export function tideState(
  station: TideStation,
  index: TidesIndex,
  at: Date,
  windowHrs = 26,
): TideState | null {
  const names = index.bundle.constituents;
  const end = new Date(at.getTime() + windowHrs * HOUR_MS);

  if (isTideRef(station)) {
    const p = getPredictor(
      `t:${station.id}`,
      names,
      station.amp,
      station.phase,
      station.datum,
    );
    const events = p
      .getExtremesPrediction({ start: at, end })
      .map((e) => toEvent(e.time, e.high, e.level));
    const level = p.getWaterLevelAtTime({ time: at }).level;
    const soon = p.getWaterLevelAtTime({
      time: new Date(at.getTime() + TREND_SAMPLE_MS),
    }).level;
    return {
      heightMeters: level,
      trend: soon >= level ? "rising" : "falling",
      events,
    };
  }

  const ref = index.tideRefById.get(station.refId);
  if (!ref) return null;
  const p = getPredictor(`t:${ref.id}`, names, ref.amp, ref.phase, ref.datum);
  // Pad the reference window so events shifted into range by the time
  // offsets aren't missed, then filter to the requested window.
  const padMs =
    (Math.max(Math.abs(station.tHigh), Math.abs(station.tLow)) + 60) * 60000;
  const events = p
    .getExtremesPrediction({
      start: new Date(at.getTime() - padMs),
      end: new Date(end.getTime() + padMs),
      offsets: subOffsets(station),
    })
    .map((e) => toEvent(e.time, e.high, e.level))
    .filter((e) => e.time >= at && e.time <= end);
  const approx = subTideNow(station, index, at);
  return {
    heightMeters: approx?.heightMeters ?? null,
    approximate: approx != null,
    trend: approx?.trend ?? (events[0]?.type === "high" ? "rising" : "falling"),
    events,
  };
}

function toEvent(time: Date, high: boolean, level: number): TideEvent {
  return { time, type: high ? "high" : "low", heightMeters: level };
}
