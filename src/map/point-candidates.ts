/**
 * Screen-space candidate finder for the targeted long-press menu (see
 * docs/gesture-model.md). Given a pressed point, returns every standalone
 * waypoint and every route with a point under the finger — the raw material
 * for menu rows like `Move waypoint "Nun 4"` / `Edit route "Salem Run"`.
 * Snapped route points sit exactly on standalone waypoints by design, so
 * multiple candidates on one spot are the expected case, not an edge case.
 */

import type { Route } from "../data/Route";
import type { StandaloneWaypoint } from "../data/Waypoint";

/** Reach of the candidate test (px) — matches the drag-handle hit radius. */
export const CANDIDATE_RADIUS_PX = 22;

export interface WaypointCandidate {
  kind: "waypoint";
  waypoint: StandaloneWaypoint;
  distancePx: number;
}

export interface RoutePointCandidate {
  kind: "route-point";
  route: Route;
  /** Index of the route's nearest waypoint to the press. */
  index: number;
  distancePx: number;
}

export type PointCandidate = WaypointCandidate | RoutePointCandidate;

/** Projects lon/lat to screen px — `map.project`, injectable for tests. */
export type Projector = (lngLat: [number, number]) => { x: number; y: number };

/**
 * All candidates within `radiusPx` of the pressed canvas point, nearest
 * first. One candidate per route (its nearest point); hidden waypoints are
 * the caller's job to exclude (pass only what is drawn).
 */
export function findPointCandidates(
  project: Projector,
  x: number,
  y: number,
  waypoints: readonly StandaloneWaypoint[],
  routes: readonly Route[],
  radiusPx: number = CANDIDATE_RADIUS_PX,
): PointCandidate[] {
  const out: PointCandidate[] = [];
  const dist = (lon: number, lat: number): number => {
    const p = project([lon, lat]);
    return Math.hypot(p.x - x, p.y - y);
  };

  for (const wp of waypoints) {
    const d = dist(wp.lon, wp.lat);
    if (d <= radiusPx)
      out.push({ kind: "waypoint", waypoint: wp, distancePx: d });
  }

  for (const route of routes) {
    let best = -1;
    let bestD = Infinity;
    route.waypoints.forEach((wp, i) => {
      const d = dist(wp.lon, wp.lat);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0 && bestD <= radiusPx) {
      out.push({ kind: "route-point", route, index: best, distancePx: bestD });
    }
  }

  out.sort((a, b) => a.distancePx - b.distancePx);
  return out;
}
