/**
 * Tap-to-identify for routes and standalone waypoints.
 *
 * Registers a contributor with the chart's unified pick list, so tapping a
 * route line or a waypoint shows a feature-info card alongside chart
 * features (cyclable with prev/next like any co-located pick). A route card
 * becoming the displayed card selects that route — the same selection the
 * Routes panel shows — and each card carries an action button that jumps to
 * the matching manager panel.
 */

import type { FeatureInfo } from "../chart/feature-info";
import type { Route } from "../data/Route";
import type { StandaloneWaypoint } from "../data/Waypoint";
import { type PickRegistry, pickBbox } from "../plugins/picking";
import { getSettings } from "../settings";
import { formatLatLon, pathDistanceNM } from "../utils/coordinates";
import { formatDistanceInSpeedUnits } from "../utils/units";
import type { RouteLayer } from "./RouteLayer";
import type { WaypointLayer } from "./WaypointLayer";

export interface RouteWaypointPickActions {
  /** A route card became the displayed card — select it as the Routes panel would. */
  onRouteShown(route: Route): void;
  /** "Open in Routes panel": open the manager with this route selected. */
  openRoute(route: Route): void;
  /** "Open in Waypoints panel": open the manager scrolled to this waypoint. */
  openWaypoint(wp: StandaloneWaypoint): void;
}

export function registerRouteWaypointPick(
  picks: PickRegistry,
  routeLayer: RouteLayer,
  waypointLayer: WaypointLayer,
  actions: RouteWaypointPickActions,
): void {
  picks.register({
    collect(point) {
      const box = pickBbox(point);
      const infos: FeatureInfo[] = [];
      // Waypoint icons are small, deliberate targets — lead with them,
      // then one card per route under the tap.
      for (const wp of waypointLayer.hitTest(box)) {
        infos.push(waypointCard(wp, actions));
      }
      for (const hit of routeLayer.hitTest(box)) {
        infos.push(routeCard(hit.route, hit.waypointIndex, actions));
      }
      return infos;
    },
  });
}

function routeCard(
  route: Route,
  waypointIndex: number | undefined,
  actions: RouteWaypointPickActions,
): FeatureInfo {
  const details: FeatureInfo["details"] = [
    { label: "Waypoints", value: String(route.waypoints.length) },
    {
      label: "Distance",
      value: formatDistanceInSpeedUnits(
        pathDistanceNM(route.waypoints),
        getSettings().speedUnit,
      ),
    },
  ];
  const wp = waypointIndex != null ? route.waypoints[waypointIndex] : undefined;
  if (wp && waypointIndex != null) {
    details.push({
      label: "Waypoint",
      value: `${wp.name} (${waypointIndex + 1} of ${route.waypoints.length})`,
    });
  }
  return {
    type: "Route",
    name: route.name,
    details,
    actions: [
      { label: "Open in Routes panel", run: () => actions.openRoute(route) },
    ],
    onDisplay: () => actions.onRouteShown(route),
  };
}

function waypointCard(
  wp: StandaloneWaypoint,
  actions: RouteWaypointPickActions,
): FeatureInfo {
  const details: FeatureInfo["details"] = [];
  if (wp.notes) details.push({ label: "Notes", value: wp.notes });
  details.push({
    label: "Position",
    value: `${formatLatLon(wp.lat, "lat")} ${formatLatLon(wp.lon, "lon")}`,
  });
  return {
    type: "Waypoint",
    name: wp.name,
    details,
    actions: [
      { label: "Open in Waypoints panel", run: () => actions.openWaypoint(wp) },
    ],
  };
}
