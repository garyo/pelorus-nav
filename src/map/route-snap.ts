/**
 * Waypoint snapping for the route editor. Placing or dragging a route
 * waypoint near an existing waypoint — a standalone waypoint or a waypoint
 * of another visible route — snaps it exactly onto that position, so routes
 * sharing a common passage render as one line instead of near-duplicates.
 *
 * Only the pure logic lives here (candidate assembly, adjacency exclusion,
 * nearest-within-radius); RouteEditor owns the map interaction and the
 * snap-target highlight.
 */

import type { Route, Waypoint } from "../data/Route";
import type { StandaloneWaypoint } from "../data/Waypoint";

/** Screen-space snap radius (px). Small enough that snapping never grabs a
 *  point the user didn't aim at; zooming in shrinks it in world terms, which
 *  is the touch-friendly opt-out (no modifier keys at sea). */
export const SNAP_RADIUS_PX = 18;

export interface SnapCandidate {
  lat: number;
  lon: number;
  name: string;
  /** Index within the route being edited; absent for external targets. */
  ownIndex?: number;
}

/** The edit operation consuming the snapped position — it determines which
 *  of the route's own waypoints are excluded. */
export type SnapOp =
  | { kind: "append"; lastIndex: number }
  | { kind: "drag"; index: number };

/** Assemble snap targets: waypoints of other visible routes, standalone
 *  waypoints, and the editing route's own points (tagged with ownIndex so
 *  adjacency exclusion can apply). */
export function collectSnapCandidates(
  otherRoutes: readonly Route[],
  standalone: readonly StandaloneWaypoint[],
  ownWaypoints: readonly Waypoint[],
): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  for (const route of otherRoutes) {
    for (const wp of route.waypoints) {
      out.push({ lat: wp.lat, lon: wp.lon, name: wp.name });
    }
  }
  for (const wp of standalone) {
    out.push({ lat: wp.lat, lon: wp.lon, name: wp.name });
  }
  ownWaypoints.forEach((wp, i) => {
    out.push({ lat: wp.lat, lon: wp.lon, name: wp.name, ownIndex: i });
  });
  return out;
}

/** Own-point adjacency rules: appending may not snap to the current last
 *  point, and a dragged point may not snap to itself or its neighbors —
 *  either would collapse a leg to zero length. Non-adjacent own points stay
 *  allowed on purpose: snapping a new point onto the route's own start
 *  closes a loop, and reusing outbound points builds a there-and-back. */
export function isExcluded(c: SnapCandidate, op: SnapOp): boolean {
  if (c.ownIndex === undefined) return false;
  if (op.kind === "append") return c.ownIndex === op.lastIndex;
  return Math.abs(c.ownIndex - op.index) <= 1;
}

/** Nearest allowed candidate within radiusPx of the screen point, or null.
 *  project converts [lon, lat] to screen px (map.project in production). */
export function findSnap(
  candidates: readonly SnapCandidate[],
  op: SnapOp,
  point: { x: number; y: number },
  project: (lonLat: [number, number]) => { x: number; y: number },
  radiusPx = SNAP_RADIUS_PX,
): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  let bestD2 = radiusPx * radiusPx;
  for (const c of candidates) {
    if (isExcluded(c, op)) continue;
    const px = project([c.lon, c.lat]);
    const dx = px.x - point.x;
    const dy = px.y - point.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      best = c;
      bestD2 = d2;
    }
  }
  return best;
}
