/**
 * Which leg to steer for when navigation starts on a route — from anywhere
 * along it, in either direction.
 *
 * A leg is a candidate when its destination waypoint lies within a forward
 * cone of the vessel's course and the vessel has not already passed it.
 * Candidates near a leg (inside a corridor) are ranked by cross-track
 * distance, the rest by distance to their destination; ties go to the leg
 * best aligned with the course, then to the one further along the route.
 * With no course (stationary), "ahead" is judged along each leg's own
 * bearing instead, and the same rule is the second pass when the course
 * points at no leg at all. The last resort is the nearest unpassed
 * waypoint.
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
  /** Nearest leg the course points along. */
  | "ahead"
  /** No leg nearby; the closest destination the course points at. */
  | "ahead-far"
  /** Judged by leg bearing: stationary, or the course points at no leg. */
  | "along-leg"
  /** Nothing ahead at all: the nearest waypoint not yet passed. */
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

/** Cross-track / destination distances closer than this are a tie. */
const TIE_NM = 0.05;

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

interface LegMetrics {
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
  const metrics: LegMetrics[] = [
    {
      leg: 0,
      xtd: d0,
      distToDest: d0,
      brgToDest: brgTo(wp0),
      legBrg: initialBearingDeg(wp0.lat, wp0.lon, wp1.lat, wp1.lon),
      passed:
        d0 < arrivalRadiusNM ||
        (d0 <= corridorNM && alongTrack(wp0, wp1, fix.lat, fix.lon) > 0),
    },
  ];
  for (let leg = 1; leg < waypoints.length; leg++) {
    const from = waypoints[leg - 1];
    const to = waypoints[leg];
    const legDist = haversineDistanceNM(from.lat, from.lon, to.lat, to.lon);
    const dTo = dist(to);
    const xtd = distanceToLegNM(fix.lat, fix.lon, from, to);
    metrics.push({
      leg,
      xtd,
      distToDest: dTo,
      brgToDest: brgTo(to),
      legBrg: initialBearingDeg(from.lat, from.lon, to.lat, to.lon),
      passed:
        dTo < arrivalRadiusNM ||
        (xtd <= corridorNM &&
          alongTrack(from, to, fix.lat, fix.lon) >= legDist - arrivalRadiusNM),
    });
  }
  return metrics;
}

interface Candidate extends LegMetrics {
  /** How far the leg's bearing is off the reference course. */
  alignment: number;
}

interface Selection {
  leg: number;
  /** No candidate was inside the corridor. */
  far: boolean;
}

/** Rank by a distance, treating near-equal distances as a tie. */
function rank(key: (c: Candidate) => number) {
  return (a: Candidate, b: Candidate): number => {
    const d = key(a) - key(b);
    if (Math.abs(d) > TIE_NM) return d;
    if (a.alignment !== b.alignment) return a.alignment - b.alignment;
    return b.leg - a.leg;
  };
}

function select(
  metrics: LegMetrics[],
  reference: (m: LegMetrics) => number,
  coneHalfAngleDeg: number,
  corridorNM: number,
): Selection | null {
  const candidates: Candidate[] = [];
  for (const m of metrics) {
    if (m.passed) continue;
    const ref = reference(m);
    if (Math.abs(bearingDelta(m.brgToDest, ref)) > coneHalfAngleDeg) continue;
    candidates.push({ ...m, alignment: Math.abs(bearingDelta(m.legBrg, ref)) });
  }
  const near = candidates.filter((c) => c.xtd <= corridorNM);
  if (near.length > 0) {
    return { leg: near.sort(rank((c) => c.xtd))[0].leg, far: false };
  }
  if (candidates.length > 0) {
    return {
      leg: candidates.sort(rank((c) => c.distToDest))[0].leg,
      far: true,
    };
  }
  return null;
}

function resolveOptions(opts: JoinOptions) {
  return {
    cone: opts.coneHalfAngleDeg ?? DEFAULT_CONE_HALF_ANGLE_DEG,
    corridor:
      opts.corridorNM ?? Math.max(CORRIDOR_FLOOR_NM, 2 * opts.arrivalRadiusNM),
  };
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
    const cog = fix.cog;
    const ahead = select(metrics, () => cog, cone, corridor);
    if (ahead) {
      return { legIndex: ahead.leg, reason: ahead.far ? "ahead-far" : "ahead" };
    }
  }
  const along = select(metrics, (m) => m.legBrg, cone, corridor);
  if (along) return { legIndex: along.leg, reason: "along-leg" };

  const unpassed = metrics.filter((m) => !m.passed);
  if (unpassed.length === 0) {
    return { legIndex: waypoints.length - 1, reason: "nearest" };
  }
  unpassed.sort((a, b) => a.distToDest - b.distToDest);
  return { legIndex: unpassed[0].leg, reason: "nearest" };
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
    const s = select(metrics, () => cog, cone, corridor);
    return s !== null && !s.far;
  };
  return !onLeg(route.waypoints) && onLeg([...route.waypoints].reverse());
}
