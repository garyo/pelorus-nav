/**
 * Route types for route planning.
 */

export interface Waypoint {
  lat: number;
  lon: number;
  name: string;
  /** The `<extensions>` this item arrived with, serialized and kept verbatim
   *  so an export can hand it back to the app that wrote it — see
   *  captureExtensions in gpx.ts. Not interpreted here. */
  sourceExtensions?: string;
}

export interface Route {
  id: string;
  /** The id this item carried in the file it was imported from (our own
   *  `pelorus:id`, or a Garmin `uuidx:uuid`). Lets a re-import of the same
   *  file update this item instead of duplicating it — see gpx-merge.ts. */
  sourceId?: string;
  name: string;
  createdAt: number;
  color: string;
  visible: boolean;
  /** Optional one-level grouping in the route manager. Absent = top level. */
  folder?: string;
  /** The `<extensions>` this item arrived with, serialized and kept verbatim
   *  so an export can hand it back to the app that wrote it — see
   *  captureExtensions in gpx.ts. Not interpreted here. */
  sourceExtensions?: string;
  waypoints: Waypoint[];
}

/** Renumber auto-generated names (WP1, WP2, …) to match array order.
 *  Custom and feature-derived names are left untouched. */
export function renumberAutoNames(waypoints: Waypoint[]): void {
  for (let i = 0; i < waypoints.length; i++) {
    if (/^WP\d+$/.test(waypoints[i].name)) {
      waypoints[i].name = `WP${i + 1}`;
    }
  }
}

/** Reverse the route's direction in place: last waypoint becomes the
 *  start. Auto-names are renumbered to follow the new order. */
export function reverseWaypoints(route: Route): void {
  route.waypoints.reverse();
  renumberAutoNames(route.waypoints);
}
