/**
 * Change gate for the per-frame vessel/chart/course render updates.
 *
 * The render handler in main.ts eases the smoothed course every frame; each
 * pass issues 3-4 GeoJSON setData calls, and MapLibre reschedules a repaint
 * whenever a source is dirty — so ungated updates form a self-sustaining
 * render loop that never idles. Skipping the updates once the smoothed
 * course has converged lets the map reach `idle` (zero scheduled frames).
 *
 * The comparison is against the last APPLIED snapshot, not the previous
 * frame: per-frame deltas can each sit below epsilon while slow creep
 * accumulates unboundedly, whereas vs-last-applied bounds the standing
 * display error to the epsilons.
 */

import { circularDistanceDeg } from "../navigation/CourseSmoothing";

export interface CourseSnapshot {
  lat: number;
  lon: number;
  cog: number;
  sog: number;
}

/** ~1.1 cm of latitude — far below visible motion at any chart zoom. */
export const POS_EPS_DEG = 1e-7;
export const COG_EPS_DEG = 0.01;
export const SOG_EPS_KT = 0.01;

/**
 * True when `next` differs enough from the last applied snapshot to warrant
 * a redraw. sog participates because course-line length depends on it.
 */
export function courseChanged(
  lastApplied: CourseSnapshot | null,
  next: CourseSnapshot,
): boolean {
  if (lastApplied === null) return true;
  return (
    Math.abs(next.lat - lastApplied.lat) +
      Math.abs(next.lon - lastApplied.lon) >=
      POS_EPS_DEG ||
    circularDistanceDeg(next.cog, lastApplied.cog) >= COG_EPS_DEG ||
    Math.abs(next.sog - lastApplied.sog) >= SOG_EPS_KT
  );
}
