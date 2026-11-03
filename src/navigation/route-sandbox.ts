/**
 * The route follower the native apps run while the app's WebView is frozen
 * in the background, to chime as each waypoint is passed: Android's service
 * evaluates it in a JavaScriptSandbox (the system WebView's engine in a
 * process of its own, with no page; RouteSandbox.kt), iOS in a
 * JavaScriptCore context (RouteSandbox.swift). It decides with the app's own
 * routeAdvance, so the two cannot disagree; the app replays the buffered
 * fixes when it wakes and reaches the same leg.
 *
 * Bundled for both by `bun tools/build-route-sandbox.ts`, which exposes the
 * global `pelorusRoute`.
 */

import { courseFrom, routeAdvance } from "./route-advance";
import { VIBRATE_ARRIVAL, VIBRATE_PASS } from "./waypoint-chime-cues";

export interface SandboxWaypoint {
  lat: number;
  lon: number;
  name: string;
}

export interface SandboxRoute {
  waypoints: SandboxWaypoint[];
  legIndex: number;
  arrivalRadiusNM: number;
}

/** What the service announces: null `next` for arrival at the last waypoint. */
export interface SandboxArrival {
  reached: string;
  next: string | null;
  /** The leg now steered, for the service to resume from after a restart. */
  legIndex: number;
  vibrate: number[];
}

let route: SandboxRoute | null = null;

/** Follow `json` (a SandboxRoute), or nothing when it is empty. */
export function setRoute(json: string): void {
  route = json ? (JSON.parse(json) as SandboxRoute) : null;
}

/** Advance on one fix; returns a SandboxArrival as JSON, or "" for none. */
export function onFix(
  lat: number,
  lon: number,
  sogKn: number | null,
  cogDeg: number | null,
): string {
  if (!route) return "";
  const step = routeAdvance(
    lat,
    lon,
    courseFrom(sogKn, cogDeg),
    route.waypoints,
    route.legIndex,
    route.arrivalRadiusNM,
  );
  if (step === "stay") return "";
  const reached = route.waypoints[route.legIndex];
  const next = step === "finish" ? null : route.waypoints[route.legIndex + 1];
  if (step === "finish") route = null;
  else route.legIndex++;
  const arrival: SandboxArrival = {
    reached: reached?.name ?? "",
    next: next ? next.name : null,
    legIndex: route ? route.legIndex : -1,
    vibrate: next ? VIBRATE_PASS : VIBRATE_ARRIVAL,
  };
  return JSON.stringify(arrival);
}
