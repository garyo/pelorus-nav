/**
 * Offline tide prediction from bundled NOAA harmonic constituents.
 *
 * Reference stations get a continuous height curve; subordinate stations
 * get high/low events only (reference extremes with NOAA time/height
 * offsets applied), matching NOAA's own published behaviour.
 */

import { isTideRef, type TideStation, type TidesIndex } from "./bundle";
import { getPredictor } from "./harmonics";

export interface TideEvent {
  time: Date;
  type: "high" | "low";
  heightMeters: number;
}

export interface TideState {
  /** Instantaneous height (m MLLW); null for subordinate stations. */
  heightMeters: number | null;
  trend: "rising" | "falling";
  /** Upcoming highs/lows within the requested window, soonest first. */
  events: TideEvent[];
}

/** Sample spacing used to detect rising/falling at reference stations. */
const TREND_SAMPLE_MS = 10 * 60 * 1000;

const HOUR_MS = 3600 * 1000;

export interface TideNow {
  /** Instantaneous height (m MLLW); null for subordinate stations. */
  heightMeters: number | null;
  trend: "rising" | "falling";
  /**
   * Position of the current height within this cycle's range:
   * 0 = at the surrounding low, 1 = at the surrounding high.
   * Null for subordinate stations (no continuous curve).
   */
  fraction: number | null;
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
    let fraction: number | null = null;
    if (extremes.length >= 2) {
      const levels = extremes.map((e) => e.level);
      const lo = Math.min(...levels);
      const hi = Math.max(...levels);
      if (hi > lo) {
        fraction = Math.min(1, Math.max(0, (level - lo) / (hi - lo)));
      }
    }
    return {
      heightMeters: level,
      trend: soon >= level ? "rising" : "falling",
      fraction,
    };
  }
  // Subordinate: trend from the next offset event (height has no curve).
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
      offsets: {
        time: { high: station.tHigh, low: station.tLow },
        height: {
          high: station.hHigh,
          low: station.hLow,
          type: station.hAdjType === "F" ? "fixed" : "ratio",
        },
      },
    })
    .map((e) => toEvent(e.time, e.high, e.level))
    .filter((e) => e.time >= at && e.time <= end);
  return {
    heightMeters: null,
    trend: events[0]?.type === "high" ? "rising" : "falling",
    events,
  };
}

function toEvent(time: Date, high: boolean, level: number): TideEvent {
  return { time, type: high ? "high" : "low", heightMeters: level };
}
