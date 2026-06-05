/**
 * Offline tidal-current prediction — NOAA reversing-current model.
 *
 * A station's major-axis harmonic sum is a signed velocity: positive =
 * flood (set `floodDir`), negative = ebb (set `ebbDir`), zero crossings =
 * slack. Reference stations are evaluated directly; subordinate stations
 * apply NOAA time adjustments and speed ratios to reference events, with
 * the standard sine/cosine interpolation between events for "now" speed.
 */

import { type CurrentStation, isCurrentRef, type TidesIndex } from "./bundle";
import { getPredictor } from "./harmonics";
import type { CurrentRefStation, CurrentSubStation } from "./schema";

export const CMS_PER_KNOT = 51.44444;

/** Below this magnitude the display state is "slack". */
export const SLACK_THRESHOLD_KN = 0.25;

export type CurrentEventType =
  | "maxFlood"
  | "slackBeforeEbb"
  | "maxEbb"
  | "slackBeforeFlood";

export interface CurrentEvent {
  time: Date;
  type: CurrentEventType;
  /** Peak speed magnitude (knots); 0 for slack. */
  speedKn: number;
}

export interface CurrentState {
  /** Instantaneous speed magnitude (knots). */
  speedKn: number;
  /** Set (degrees true): floodDir or ebbDir according to state. */
  dir: number;
  state: "flood" | "ebb" | "slack";
  /** Upcoming events within the requested window, soonest first. */
  events: CurrentEvent[];
}

const HOUR_MS = 3600 * 1000;
/** Slack-finding bisection stops when the bracket is this small. */
const SLACK_PRECISION_MS = 30 * 1000;

// ── Reference-station event computation (cached windows) ─────────────
//
// Computing a station's events runs an extremes prediction plus a few
// bisections, so windows of [at−12h, at+36h] are cached per station and
// reused until `at` drifts outside the comfortably-covered range.

interface EventWindow {
  startMs: number;
  endMs: number;
  events: CurrentEvent[];
}

const eventCache = new Map<string, EventWindow>();

const SPAN_BACK_MS = 12 * HOUR_MS;
const SPAN_FWD_MS = 36 * HOUR_MS;

function refEvents(
  ref: CurrentRefStation,
  names: string[],
  at: Date,
): CurrentEvent[] {
  const key = `${ref.id}_${ref.bin}`;
  const cached = eventCache.get(key);
  // Reuse while [at−6h, at+26h] stays inside the cached span.
  if (
    cached &&
    at.getTime() - 6 * HOUR_MS >= cached.startMs &&
    at.getTime() + 26 * HOUR_MS <= cached.endMs
  ) {
    return cached.events;
  }

  const startMs = at.getTime() - SPAN_BACK_MS;
  const endMs = at.getTime() + SPAN_FWD_MS;
  const p = getPredictor(`c:${key}`, names, ref.amp, ref.phase, false);

  const extremes = p.getExtremesPrediction({
    start: new Date(startMs),
    end: new Date(endMs),
  });
  const events: CurrentEvent[] = extremes.map((e) => ({
    time: e.time,
    type: e.level >= 0 ? "maxFlood" : "maxEbb",
    speedKn: Math.abs(e.level) / CMS_PER_KNOT,
  }));

  // Slack between adjacent opposite-signed extremes: bisect the zero crossing.
  const velAt = (ms: number): number =>
    p.getWaterLevelAtTime({ time: new Date(ms) }).level;
  for (let i = 0; i + 1 < extremes.length; i++) {
    const a = extremes[i];
    const b = extremes[i + 1];
    if (a.level >= 0 === b.level >= 0) continue;
    let lo = a.time.getTime();
    let hi = b.time.getTime();
    const aPositive = a.level >= 0;
    while (hi - lo > SLACK_PRECISION_MS) {
      const mid = (lo + hi) / 2;
      if (velAt(mid) >= 0 === aPositive) lo = mid;
      else hi = mid;
    }
    events.push({
      time: new Date((lo + hi) / 2),
      type: b.level >= 0 ? "slackBeforeFlood" : "slackBeforeEbb",
      speedKn: 0,
    });
  }
  events.sort((x, y) => x.time.getTime() - y.time.getTime());

  eventCache.set(key, { startMs, endMs, events });
  return events;
}

/** Per-event-type subordinate adjustment: time shift + speed ratio. */
function subAdjustment(
  type: CurrentEventType,
  sub: CurrentSubStation,
): { offsetMin: number; ratio: number } {
  switch (type) {
    case "maxFlood":
      return { offsetMin: sub.mfcTime, ratio: sub.mfcAmp };
    case "maxEbb":
      return { offsetMin: sub.mecTime, ratio: sub.mecAmp };
    case "slackBeforeEbb":
      return { offsetMin: sub.sbeTime, ratio: 1 };
    case "slackBeforeFlood":
      return { offsetMin: sub.sbfTime, ratio: 1 };
  }
}

/** Apply NOAA subordinate adjustments to reference events. */
function subEvents(
  sub: CurrentSubStation,
  refEventList: CurrentEvent[],
): CurrentEvent[] {
  const adjusted = refEventList.map((e): CurrentEvent => {
    const { offsetMin, ratio } = subAdjustment(e.type, sub);
    return {
      time: new Date(e.time.getTime() + offsetMin * 60000),
      type: e.type,
      speedKn: e.speedKn * ratio,
    };
  });
  adjusted.sort((x, y) => x.time.getTime() - y.time.getTime());
  return adjusted;
}

// ── Now-state interpolation between events ───────────────────────────

const signedPeak = (e: CurrentEvent): number =>
  e.type === "maxFlood" ? e.speedKn : e.type === "maxEbb" ? -e.speedKn : 0;

const isSlack = (e: CurrentEvent): boolean => e.speedKn === 0;

/**
 * Estimate signed speed at `at` from the bracketing events using the
 * standard slack↔max sine/cosine shape (NOAA tidal current tables, Table 3).
 */
function interpolateSpeed(events: CurrentEvent[], at: Date): number {
  const t = at.getTime();
  let prev: CurrentEvent | null = null;
  let next: CurrentEvent | null = null;
  for (const e of events) {
    if (e.time.getTime() <= t) prev = e;
    else {
      next = e;
      break;
    }
  }
  if (!prev || !next) {
    const nearest = prev ?? next;
    return nearest ? signedPeak(nearest) : 0;
  }
  const frac =
    (t - prev.time.getTime()) / (next.time.getTime() - prev.time.getTime());
  if (isSlack(prev) && !isSlack(next)) {
    return signedPeak(next) * Math.sin((Math.PI / 2) * frac);
  }
  if (!isSlack(prev) && isSlack(next)) {
    return signedPeak(prev) * Math.cos((Math.PI / 2) * frac);
  }
  // Adjacent events of the same kind (no zero crossing): linear blend.
  return signedPeak(prev) + (signedPeak(next) - signedPeak(prev)) * frac;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Predict the current at `station` for time `at`.
 * Returns null if a subordinate's reference station bin is missing.
 */
export function currentState(
  station: CurrentStation,
  index: TidesIndex,
  at: Date,
  windowHrs = 26,
): CurrentState | null {
  const names = index.bundle.constituents;

  let signedKn: number;
  let allEvents: CurrentEvent[];
  if (isCurrentRef(station)) {
    allEvents = refEvents(station, names, at);
    const p = getPredictor(
      `c:${station.id}_${station.bin}`,
      names,
      station.amp,
      station.phase,
      false,
    );
    signedKn = p.getWaterLevelAtTime({ time: at }).level / CMS_PER_KNOT;
  } else {
    const ref = index.currentRefByKey.get(`${station.refId}_${station.refBin}`);
    if (!ref) return null;
    allEvents = subEvents(station, refEvents(ref, names, at));
    signedKn = interpolateSpeed(allEvents, at);
  }

  const state =
    Math.abs(signedKn) < SLACK_THRESHOLD_KN
      ? "slack"
      : signedKn > 0
        ? "flood"
        : "ebb";
  const nextMax = allEvents.find((e) => e.time >= at && !isSlack(e));
  const dir =
    state === "flood" || (state === "slack" && nextMax?.type === "maxFlood")
      ? station.floodDir
      : state === "ebb" || nextMax?.type === "maxEbb"
        ? station.ebbDir
        : station.floodDir;

  const end = new Date(at.getTime() + windowHrs * HOUR_MS);
  return {
    speedKn: Math.abs(signedKn),
    dir,
    state,
    events: allEvents.filter((e) => e.time >= at && e.time <= end),
  };
}
