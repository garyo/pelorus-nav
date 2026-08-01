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
  /** Id carried in the file this was imported from — see gpx-merge.ts. */
  sourceId?: string;
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
  /** The `<extensions>` this item arrived with, serialized and kept verbatim
   *  so an export can hand it back to the app that wrote it — see
   *  captureExtensions in gpx.ts. Not interpreted here. */
  sourceExtensions?: string;
}
