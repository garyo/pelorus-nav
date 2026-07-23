/**
 * Geometric hit-testing for draggable map handles.
 *
 * MapLibre's queryRenderedFeatures answers symbol queries from the collision
 * index, which is rebuilt asynchronously and lags the camera during and just
 * after a pan: a tap that lands on a handle can miss because the index still
 * holds the pre-pan position. iPad field logs showed edit taps 11 px from a
 * waypoint reported as misses, and whole handle sets reported as unplaced
 * while plainly on screen. Projecting the handles ourselves is exact, needs
 * no rendered frame, and is cheaper than a tile query.
 */

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

/**
 * Index of the handle nearest `target` within `radius` px, or null when none
 * is close enough. Ties go to the later handle — handles drawn on top of
 * earlier ones win, matching what the user sees.
 */
export function nearestPointIndex(
  points: readonly GeoPoint[],
  target: ScreenPoint,
  project: (lonLat: [number, number]) => ScreenPoint,
  radius: number,
): number | null {
  let bestIndex: number | null = null;
  let bestDist = radius;
  for (let i = 0; i < points.length; i++) {
    const p = project([points[i].lon, points[i].lat]);
    const d = Math.hypot(p.x - target.x, p.y - target.y);
    if (d <= bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }
  return bestIndex;
}
