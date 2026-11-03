/**
 * One fix's worth of following a route: whether it reaches or passes the
 * waypoint being steered for. Pure, so the app's ActiveNavigation and the
 * Android background service, which runs a bundled copy while the app is
 * frozen (see route-sandbox.ts), decide alike.
 */

import {
  type LatLon,
  waypointPassNM,
  waypointReached,
} from "./waypoint-passing";

/** Below this speed over ground the vessel has no course worth steering by. */
export const MIN_COURSE_SOG_KN = 0.5;

/** Course over ground, or null when unknown or the vessel is all but still. */
export function courseFrom(
  sogKn: number | null | undefined,
  cogDeg: number | null | undefined,
): number | null {
  if (sogKn == null || sogKn < MIN_COURSE_SOG_KN) return null;
  return cogDeg ?? null;
}

/**
 * "stay" on the current leg, move to the "next" one (the target was reached
 * or passed), or "finish" on reaching the last waypoint, which only reaching
 * it ends.
 */
export type RouteAdvance = "stay" | "next" | "finish";

export function routeAdvance(
  lat: number,
  lon: number,
  cogDeg: number | null,
  waypoints: readonly LatLon[],
  legIndex: number,
  arrivalRadiusNM: number,
): RouteAdvance {
  const target = waypoints[legIndex];
  if (!target) return "stay";
  const isLast = legIndex + 1 >= waypoints.length;
  if (waypointReached(lat, lon, cogDeg, target, arrivalRadiusNM, isLast)) {
    return isLast ? "finish" : "next";
  }
  if (isLast) return "stay";
  const passed =
    waypointPassNM(
      lat,
      lon,
      cogDeg,
      waypoints[legIndex - 1] ?? null,
      target,
      waypoints[legIndex + 1],
    ) >= 0;
  return passed ? "next" : "stay";
}
