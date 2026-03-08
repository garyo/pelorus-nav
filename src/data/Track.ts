/**
 * Track types for GPS track recording.
 */

export interface TrackPoint {
  lat: number;
  lon: number;
  timestamp: number;
  sog: number | null;
  cog: number | null;
}

export interface TrackMeta {
  id: string;
  name: string;
  createdAt: number;
  color: string;
  visible: boolean;
  pointCount: number;
}

export interface Track extends TrackMeta {
  points: TrackPoint[];
}
