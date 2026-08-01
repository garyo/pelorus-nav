/**
 * Standalone waypoint types for marking locations on the chart.
 */

export type WaypointIcon =
  | "default"
  | "anchorage"
  | "hazard"
  | "fuel"
  | "poi"
  | "cob";

export interface StandaloneWaypoint {
  id: string;
  lat: number;
  lon: number;
  name: string;
  notes: string;
  icon: WaypointIcon;
  createdAt: number;
  updatedAt: number;
  /** Drawn on the chart. Records written before this field existed have no
   *  value; getAllWaypoints defaults them to visible. */
  visible: boolean;
  /** Optional one-level grouping in the waypoint manager. Absent = top level. */
  folder?: string;
}
