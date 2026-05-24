/**
 * Track types for GPS track recording.
 */

import { haversineDistanceNM } from "../utils/coordinates";

export interface TrackPoint {
  /** Smoothed lat/lon if the track has been post-processed; raw otherwise. */
  lat: number;
  lon: number;
  timestamp: number;
  sog: number | null;
  cog: number | null;
  /** Horizontal accuracy in meters as reported by the GPS source. Used by
   *  the recorder to reject low-quality fixes (cell-tower / WiFi fallbacks)
   *  and preserved for diagnostic export. */
  accuracy?: number | null;
  /** Original raw lat/lon, preserved when the track is smoothed. */
  rawLat?: number;
  rawLon?: number;
  /** True for fixes the post-processor flagged as outliers. They keep
   *  their raw position but are hidden from rendering and exports. */
  dropped?: boolean;
}

export interface TrackMeta {
  id: string;
  name: string;
  createdAt: number;
  color: string;
  visible: boolean;
  pointCount: number;
  /** Set true after the Stop-time RTS post-processor has run. Implies
   *  every point has rawLat/rawLon and the lat/lon fields are smoothed. */
  smoothed?: boolean;
  /** Total wall-clock span of the recording in milliseconds (last fix
   *  timestamp − first fix timestamp). Maintained incrementally during
   *  recording and recomputed by the RTS post-processor. */
  durationMs?: number;
  /** Total over-ground distance in nautical miles, summed between
   *  consecutive accepted fixes. For smoothed tracks this excludes the
   *  `dropped: true` outliers and uses smoothed positions. Maintained
   *  incrementally during recording. */
  totalDistanceNM?: number;
}

export interface Track extends TrackMeta {
  points: TrackPoint[];
}

/**
 * Compute total wall-clock duration and total over-ground distance for
 * a sequence of points. Skips `dropped: true` outliers when summing
 * distance (their positions are wrong, so the haversine segments to
 * them would inflate the total). Used by the recorder on RTS
 * post-processing and lazily by the track-list panel for legacy tracks
 * recorded before these fields were cached on TrackMeta.
 *
 * Assumes points are already sorted ascending by timestamp.
 */
export function computeTrackAggregates(points: TrackPoint[]): {
  durationMs: number;
  totalDistanceNM: number;
} {
  if (points.length === 0) return { durationMs: 0, totalDistanceNM: 0 };
  const durationMs = Math.max(
    0,
    points[points.length - 1].timestamp - points[0].timestamp,
  );
  let totalDistanceNM = 0;
  let prevLat: number | null = null;
  let prevLon: number | null = null;
  for (const p of points) {
    if (p.dropped) continue;
    if (prevLat !== null && prevLon !== null) {
      totalDistanceNM += haversineDistanceNM(prevLat, prevLon, p.lat, p.lon);
    }
    prevLat = p.lat;
    prevLon = p.lon;
  }
  return { durationMs, totalDistanceNM };
}
