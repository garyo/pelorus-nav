/**
 * When a vessel has passed a route waypoint without reaching it.
 *
 * Passing it abeam: crossing the line through the waypoint square to the
 * leg arriving at it. That alone misses a vessel that turns for the next
 * leg early — cutting inside the turn, or running a lane offset to the
 * inside — which can leave the waypoint astern without ever drawing level
 * with it, so navigation would steer back for a waypoint already done with.
 *
 * So the waypoint is also passed once it is abeam or abaft the beam of the
 * course over ground and the vessel is across the bisector of the turn,
 * nearer the next leg than the arriving one. Neither suffices alone: across
 * the bisector a vessel can still be heading for the waypoint (one that
 * overshot the previous waypoint and runs up a short leg far off its line),
 * and a waypoint abaft the beam says nothing of which leg the vessel is on
 * (it is so, for a moment, on every circuit while circling short of it).
 *
 * A route that turns straight back (an out-and-back to the same point) has
 * both legs on one line, and no side of it is nearer either; there the
 * waypoint is passed on the course alone. That makes the turn count only
 * once the vessel is some way along the arriving leg: one leaving the
 * start of an out-and-back headed away from it, as out of a slip, has the
 * turn astern and is as near the return leg as the outbound one.
 *
 * The rules were tuned against simulated helmsmen (corner cutting, offset
 * lanes, overshoots, circling, departures headed the wrong way, sparse noisy
 * fixes). Known failings, both at turns sharper than about 135°: circling
 * short of the waypoint can pass it early, and cutting it so short that the
 * vessel runs back into the arriving leg's first quarter never passes it.
 */

import {
  bearingDelta,
  haversineDistanceNM,
  initialBearingDeg,
} from "../utils/coordinates";

export interface LatLon {
  lat: number;
  lon: number;
}

/** A turn at least this sharp is taken as turning straight back. */
export const REVERSAL_DEG = 175;

/** Fraction of the arriving leg to cover before its turn can be passed. */
export const TURN_MIN_PROGRESS = 0.25;

/**
 * Signed distance (NM) the vessel lies beyond the waypoint's passing line:
 * ≥ 0 once it has passed. `cogDeg` is null when the course is unknown or
 * meaningless (stopped, drifting), leaving only the abeam line. `prev` is
 * null for a route's first waypoint, which has no arriving leg (the route's
 * leaving bearing stands in for it); `next` is null for the last, which has
 * no turn. A lone waypoint has no line and is never passed.
 */
export function waypointPassNM(
  lat: number,
  lon: number,
  cogDeg: number | null,
  prev: LatLon | null,
  wp: LatLon,
  next: LatLon | null,
): number {
  const leaving =
    next === null
      ? null
      : initialBearingDeg(wp.lat, wp.lon, next.lat, next.lon);
  const arriving =
    prev === null
      ? leaving
      : (initialBearingDeg(wp.lat, wp.lon, prev.lat, prev.lon) + 180) % 360;
  if (arriving === null) return Number.NEGATIVE_INFINITY;

  const dist = haversineDistanceNM(wp.lat, wp.lon, lat, lon);
  const brg = initialBearingDeg(wp.lat, wp.lon, lat, lon);
  const beyond = (normalDeg: number) =>
    dist * Math.cos(((brg - normalDeg) * Math.PI) / 180);
  const abeam = beyond(arriving);
  if (cogDeg === null || leaving === null) return abeam;
  if (prev !== null) {
    const legNM = haversineDistanceNM(prev.lat, prev.lon, wp.lat, wp.lon);
    if (abeam < -(1 - TURN_MIN_PROGRESS) * legNM) return abeam;
  }

  const offBow = Math.abs(
    bearingDelta(initialBearingDeg(lat, lon, wp.lat, wp.lon), cogDeg),
  );
  if (offBow < 90) return abeam;
  const turn = bearingDelta(leaving, arriving);
  const turnSide =
    Math.abs(turn) >= REVERSAL_DEG ? 0 : beyond(arriving + turn / 2);
  return Math.max(abeam, turnSide);
}
