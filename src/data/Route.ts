/**
 * Route types for route planning.
 */

export interface Waypoint {
  lat: number;
  lon: number;
  name: string;
}

export interface Route {
  id: string;
  name: string;
  createdAt: number;
  color: string;
  visible: boolean;
  /** Optional one-level grouping in the route manager. Absent = top level. */
  folder?: string;
  waypoints: Waypoint[];
}
