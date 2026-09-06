/**
 * Which leg to steer for when navigation starts on a route — from anywhere
 * along it, in either direction.
 *
 * Under way, a leg is a candidate when its destination waypoint lies within
 * a forward cone of the course and the vessel has not already passed it;
 * candidates rank by cross-track distance — the leg the vessel is nearest
 * wins — with course alignment, then route order, as tie-breaks. So a
 * vessel level with a waypoint takes the leg leaving it, not the one
 * arriving. Stationary, or when the course points at no leg, the nearest
 * unpassed leg wins outright.
 */

import type { Route, Waypoint } from "../data/Route";
import {
  alongTrackDistanceNM,
  bearingDelta,
  haversineDistanceNM,
  initialBearingDeg,
} from "../utils/coordinates";

export interface JoinFix {
  lat: number;
  lon: number;
  /** Course over ground, or null when stationary / unknown. */
  cog: number | null;
}

export interface JoinOptions {
  arrivalRadiusNM: number;
  /** Half-angle of the forward cone a destination must fall within. */
  coneHalfAngleDeg?: number;
  /** Cross-track distance within which a leg counts as "the one we're on". */
  corridorNM?: number;
}

export type JoinReason =
  /** The leg the vessel is on, its destination ahead. */
  | "ahead"
  /** No leg nearby; the nearest leg whose destination is ahead. */
  | "ahead-far"
  /** Stationary, or nothing ahead: the nearest leg not yet passed. */
  | "nearest";

export interface JoinChoice {
  /** Targets waypoints[legIndex]; 0 means "sail to the first waypoint". */
  legIndex: number;
  reason: JoinReason;
}

export const DEFAULT_CONE_HALF_ANGLE_DEG = 75;

/**
 * Corridor half-width floor, so ordinary cross-track error (hand steering,
 * drift while the app was down) never disqualifies the leg being sailed.
 */
export const CORRIDOR_FLOOR_NM = 2;

/** Cross-track distances this close (absolute, or as a fraction) are a tie. */
const TIE_NM = 0.05;
const TIE_FRACTION = 0.1;

/** Shortest distance from a point to the leg segment from→to, in NM. */
export function distanceToLegNM(
  lat: number,
  lon: number,
  from: Waypoint,
  to: Waypoint,
): number {
  const legDist = haversineDistanceNM(from.lat, from.lon, to.lat, to.lon);
  const dFrom = haversineDistanceNM(lat, lon, from.lat, from.lon);
  const dTo = haversineDistanceNM(lat, lon, to.lat, to.lon);
  if (legDist < 1e-6) return Math.min(dFrom, dTo);
  const atd = alongTrack(from, to, lat, lon);
  if (atd <= 0) return dFrom;
  if (atd >= legDist) return dTo;
  // Cross-track distance via Pythagoras on the start-distance/along-track pair
  // (planar approximation — fine at corridor scales of a few NM).
  return Math.sqrt(Math.max(0, dFrom * dFrom - atd * atd));
}

/**
 * Along-track distance with the one numerical hole plugged: for a point on
 * (or at) the leg's start the great-circle formula can take acos of a value
 * a rounding error above 1, and the limit there is zero progress.
 */
function alongTrack(from: Waypoint, to: Waypoint, lat: number, lon: number) {
  const atd = alongTrackDistanceNM(
    from.lat,
    from.lon,
    to.lat,
    to.lon,
    lat,
    lon,
  );
  return Number.isNaN(atd) ? 0 : atd;
}

export interface LegMetrics {
  leg: number;
  /** Distance from the leg segment (for leg 0, from its waypoint). */
  xtd: number;
  distToDest: number;
  brgToDest: number;
  /** The leg's own bearing (for leg 0, the bearing the route leaves it on). */
  legBrg: number;
  /**
   * The destination is within the arrival radius, or — for a leg the
   * vessel is on (inside the corridor) — behind its perpendicular. Far from
   * a leg the perpendicular means nothing: a waypoint 15 NM off the bow is
   * still ahead however the route leaves it.
   */
  passed: boolean;
  /** The vessel is beyond the leg's end (for leg 0, beyond its waypoint). */
  beyondEnd: boolean;
}

function legMetrics(
  fix: JoinFix,
  waypoints: readonly Waypoint[],
  arrivalRadiusNM: number,
  corridorNM: number,
): LegMetrics[] {
  const dist = (wp: Waypoint) =>
    haversineDistanceNM(fix.lat, fix.lon, wp.lat, wp.lon);
  const brgTo = (wp: Waypoint) =>
    initialBearingDeg(fix.lat, fix.lon, wp.lat, wp.lon);
  const [wp0, wp1] = waypoints;
  const d0 = dist(wp0);
  const beyond0 = alongTrack(wp0, wp1, fix.lat, fix.lon) > 0;
  const metrics: LegMetrics[] = [
    {
      leg: 0,
      xtd: d0,
      distToDest: d0,
      brgToDest: brgTo(wp0),
      legBrg: initialBearingDeg(wp0.lat, wp0.lon, wp1.lat, wp1.lon),
      passed: d0 < arrivalRadiusNM || (d0 <= corridorNM && beyond0),
      beyondEnd: beyond0,
    },
  ];
  for (let leg = 1; leg < waypoints.length; leg++) {
    const from = waypoints[leg - 1];
    const to = waypoints[leg];
    const legDist = haversineDistanceNM(from.lat, from.lon, to.lat, to.lon);
    const dTo = dist(to);
    const xtd = distanceToLegNM(fix.lat, fix.lon, from, to);
    const beyondEnd =
      alongTrack(from, to, fix.lat, fix.lon) >= legDist - arrivalRadiusNM;
    metrics.push({
      leg,
      xtd,
      distToDest: dTo,
      brgToDest: brgTo(to),
      legBrg: initialBearingDeg(from.lat, from.lon, to.lat, to.lon),
      passed: dTo < arrivalRadiusNM || (xtd <= corridorNM && beyondEnd),
      beyondEnd,
    });
  }
  return metrics;
}

interface Candidate extends LegMetrics {
  /** How far the leg's bearing is off the course; 0 when stationary. */
  alignment: number;
}

/**
 * Rank by cross-track distance. Near-equal distances — a vessel level with
 * the waypoint two legs share, or short of the route's start — go to a leg
 * the vessel has not already run past the end of (the leg leaving that
 * waypoint, not the one arriving), then to the leg best aligned with the
 * course, then to route order.
 */
function rank(a: Candidate, b: Candidate): number {
  const d = a.xtd - b.xtd;
  const tie = Math.max(TIE_NM, TIE_FRACTION * Math.max(a.xtd, b.xtd));
  if (Math.abs(d) > tie) return d;
  if (a.beyondEnd !== b.beyondEnd) return a.beyondEnd ? 1 : -1;
  if (a.alignment !== b.alignment) return a.alignment - b.alignment;
  return a.leg - b.leg;
}

/** Unpassed legs whose destination lies within the cone of `cog`, best first. */
function aheadCandidates(
  metrics: LegMetrics[],
  cog: number,
  coneHalfAngleDeg: number,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const m of metrics) {
    if (m.passed) continue;
    if (Math.abs(bearingDelta(m.brgToDest, cog)) > coneHalfAngleDeg) continue;
    candidates.push({ ...m, alignment: Math.abs(bearingDelta(m.legBrg, cog)) });
  }
  return candidates.sort(rank);
}

/** Unpassed legs by proximity, best first. */
function nearestCandidates(metrics: LegMetrics[]): Candidate[] {
  return metrics
    .filter((m) => !m.passed)
    .map((m) => ({ ...m, alignment: 0 }))
    .sort(rank);
}

function resolveOptions(opts: JoinOptions) {
  return {
    cone: opts.coneHalfAngleDeg ?? DEFAULT_CONE_HALF_ANGLE_DEG,
    corridor:
      opts.corridorNM ?? Math.max(CORRIDOR_FLOOR_NM, 2 * opts.arrivalRadiusNM),
  };
}

/** The per-leg numbers behind a choice, for tests and the review tool. */
export function describeJoinLegs(
  fix: JoinFix,
  route: Route,
  opts: JoinOptions,
): LegMetrics[] {
  if (route.waypoints.length < 2) return [];
  const { corridor } = resolveOptions(opts);
  return legMetrics(fix, route.waypoints, opts.arrivalRadiusNM, corridor);
}

export function pickJoinLeg(
  fix: JoinFix,
  route: Route,
  opts: JoinOptions,
): JoinChoice {
  const waypoints = route.waypoints;
  if (waypoints.length < 2) return { legIndex: 1, reason: "nearest" };
  const { cone, corridor } = resolveOptions(opts);
  const metrics = legMetrics(fix, waypoints, opts.arrivalRadiusNM, corridor);

  if (fix.cog !== null) {
    const [best] = aheadCandidates(metrics, fix.cog, cone);
    if (best) {
      return {
        legIndex: best.leg,
        reason: best.xtd <= corridor ? "ahead" : "ahead-far",
      };
    }
  }
  const [nearest] = nearestCandidates(metrics);
  return {
    legIndex: nearest ? nearest.leg : waypoints.length - 1,
    reason: "nearest",
  };
}

/**
 * True when the course points along no leg of the route as drawn but does
 * point along a leg of the route reversed — the user is about to sail it
 * the other way and would rather reverse it than be steered backwards.
 */
export function suggestReverse(
  fix: JoinFix,
  route: Route,
  opts: JoinOptions,
): boolean {
  if (fix.cog === null || route.waypoints.length < 2) return false;
  const cog = fix.cog;
  const { cone, corridor } = resolveOptions(opts);
  const onLeg = (waypoints: readonly Waypoint[]) => {
    const metrics = legMetrics(fix, waypoints, opts.arrivalRadiusNM, corridor);
    const [best] = aheadCandidates(metrics, cog, cone);
    return best !== undefined && best.xtd <= corridor;
  };
  return !onLeg(route.waypoints) && onLeg([...route.waypoints].reverse());
}
