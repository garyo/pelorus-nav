/**
 * Track types for GPS track recording.
 */

export interface TrackPoint {
  /** Smoothed lat/lon if the track has been post-processed; raw otherwise. */
  lat: number;
  lon: number;
  timestamp: number;
  sog: number | null;
  cog: number | null;
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
}

export interface Track extends TrackMeta {
  points: TrackPoint[];
}
