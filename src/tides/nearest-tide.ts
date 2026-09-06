/**
 * "What's the tide here?" — the nearest tide station, and the nearby ones
 * that would give a materially different answer.
 *
 * Real high and low waters routinely run 10–15 minutes off the prediction
 * with wind and pressure, so two stations whose next event falls within
 * ten minutes of each other are the same answer; only stations that
 * disagree by more than that are worth offering as alternatives.
 */

import {
  DEFAULT_NEAREST_STATION_NM,
  nearestStations,
  type TideStation,
  type TidesIndex,
} from "./bundle";
import { type TideEvent, tideState } from "./predictor";

/** Up to this many alternatives beyond the nearest station are considered. */
export const NEAREST_TIDE_ALTERNATIVES = 3;
/** Next-event times closer than this agree. */
export const TIDE_AGREE_MIN = 10;
/**
 * Predictions start this far back so a low that passed a few minutes ago
 * at one station still matches a low still coming at another, rather
 * than that station's next low a cycle away.
 */
const BACK_PAD_HRS = 3;
const WINDOW_HRS = 26 + BACK_PAD_HRS;
const MIN_MS = 60_000;

export interface StationChoice {
  station: TideStation;
  distanceNM: number;
  /** The first high or low still to come. */
  next: TideEvent;
  /** Events from a few hours back through the next day. */
  events: TideEvent[];
}

export interface NearestTideResult {
  primary: StationChoice;
  /** Nearby stations whose next event disagrees with the primary's. */
  alternatives: StationChoice[];
}

export interface NearestTideOptions {
  maxNM?: number;
  /** Alternatives to consider beyond the nearest station. */
  alternatives?: number;
  agreeMin?: number;
}

/** The event of `ref`'s type closest in time to it, or null if none. */
export function matchingEvent(
  events: TideEvent[],
  ref: TideEvent,
): TideEvent | null {
  let best: TideEvent | null = null;
  for (const e of events) {
    if (e.type !== ref.type) continue;
    if (
      !best ||
      Math.abs(e.time.getTime() - ref.time.getTime()) <
        Math.abs(best.time.getTime() - ref.time.getTime())
    ) {
      best = e;
    }
  }
  return best;
}

export function chooseNearestTide(
  index: TidesIndex,
  lat: number,
  lon: number,
  at: Date,
  opts: NearestTideOptions = {},
): NearestTideResult | null {
  const maxNM = opts.maxNM ?? DEFAULT_NEAREST_STATION_NM;
  const limit = 1 + (opts.alternatives ?? NEAREST_TIDE_ALTERNATIVES);
  const agreeMs = (opts.agreeMin ?? TIDE_AGREE_MIN) * MIN_MS;
  const from = new Date(at.getTime() - BACK_PAD_HRS * 3_600_000);

  const choices: StationChoice[] = [];
  for (const { station, distanceNM } of nearestStations(
    index.tideStations,
    lat,
    lon,
    maxNM,
    limit,
  )) {
    const state = tideState(station, index, from, WINDOW_HRS);
    const next = state?.events.find((e) => e.time >= at);
    if (!state || !next) continue;
    choices.push({ station, distanceNM, next, events: state.events });
  }
  if (choices.length === 0) return null;

  const [primary, ...others] = choices;
  const alternatives = others.filter((c) => {
    const match = matchingEvent(c.events, primary.next);
    return (
      !match ||
      Math.abs(match.time.getTime() - primary.next.time.getTime()) > agreeMs
    );
  });
  return { primary, alternatives };
}
