/**
 * Standalone waypoint types for marking locations on the chart.
 */

import type { WaypointColor } from "./waypoint-symbols";

/**
 * Two kinds of icon in one list: semantic ones that own their colour, and
 * geometric shapes the user colours. See waypoint-symbols.ts for why the
 * split exists and which is which.
 */
export type WaypointIcon =
  // Semantic — fixed colour.
  | "default"
  | "anchorage"
  | "hazard"
  | "fuel"
  | "poi"
  | "cob"
  // Geometric — user-coloured (GEOMETRIC_ICONS).
  | "triangle"
  | "circle"
  | "square"
  | "diamond"
  | "flag"
  | "pin"
  | "house";

export interface StandaloneWaypoint {
  id: string;
  /** Id carried in the file this was imported from — see gpx-merge.ts. */
  sourceId?: string;
  lat: number;
  lon: number;
  name: string;
  notes: string;
  icon: WaypointIcon;
  /** Only meaningful for a geometric icon; the semantic ones own their
   *  colour. Absent = DEFAULT_WAYPOINT_COLOR. */
  color?: WaypointColor;
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
