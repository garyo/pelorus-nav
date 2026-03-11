/**
 * Standalone waypoint types for marking locations on the chart.
 */

export type WaypointIcon = "default" | "anchorage" | "hazard" | "fuel" | "poi";

export interface StandaloneWaypoint {
  id: string;
  lat: number;
  lon: number;
  name: string;
  notes: string;
  icon: WaypointIcon;
  createdAt: number;
  updatedAt: number;
}
