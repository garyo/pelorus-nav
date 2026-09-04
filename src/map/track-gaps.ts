/**
 * Split a track's points where recording stopped for a while, so the
 * renderer can show a hole as a hole instead of one straight line across
 * whatever the vessel actually sailed around (a process kill under way
 * looked like a track crossing an island).
 *
 * The threshold sits well above the longest hole a healthy screen-off
 * recording produces: a 20 s passive cadence plus a 90 s watchdog and its
 * 60 s recovery kick is under three minutes.
 */

export const TRACK_GAP_MS = 5 * 60 * 1000;

export interface TimedPoint {
  timestamp: number;
}

export interface GapSplit<T> {
  /** Runs of points recorded without a gap, in order. */
  segments: T[][];
  /** The two points bracketing each gap, in order. */
  bridges: [T, T][];
}

/**
 * Points must be in chronological order. Pure — exported for testing.
 */
export function splitAtGaps<T extends TimedPoint>(
  points: T[],
  gapMs: number = TRACK_GAP_MS,
): GapSplit<T> {
  const segments: T[][] = [];
  const bridges: [T, T][] = [];
  let current: T[] = [];
  for (const point of points) {
    const prev = current[current.length - 1];
    if (prev && point.timestamp - prev.timestamp > gapMs) {
      segments.push(current);
      bridges.push([prev, point]);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) segments.push(current);
  return { segments, bridges };
}
