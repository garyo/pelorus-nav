/**
 * Keeps the Android background service's copy of the active route current,
 * so it can chime as waypoints are passed while the app is frozen (see
 * route-sandbox.ts). Sends the route and leg whenever either changes, and
 * nothing — clearing the service's copy — when not following a route, when
 * the waypoint chime is turned off, or when the position comes from a source
 * only the frozen app can read. `onFollowing` hears whether the service has a
 * route, which is a reason to keep GPS running in the background.
 */

import { Capacitor } from "@capacitor/core";
import { BackgroundGPS, type RouteWatchSource } from "../plugins/BackgroundGPS";
import { getSettings, onSettingsChange } from "../settings";
import type {
  ActiveNavigationManager,
  ActiveNavigationState,
} from "./ActiveNavigation";
import type { SandboxRoute } from "./route-sandbox";

/**
 * Where the service reads positions for a GPS source: the device's own GPS,
 * or the Bluetooth serial receiver's stream. Null for sources that reach only
 * the app (Signal K, the BLE pod, the simulator), which freeze with it.
 */
export function routeWatchSource(gpsSource: string): RouteWatchSource | null {
  if (gpsSource === "capacitor-gps") return "device";
  if (gpsSource === "bt-spp") return "serial";
  return null;
}

/** The route the service should follow for `state`, or null for none. */
export function sandboxRouteFor(
  state: ActiveNavigationState,
  chime: boolean,
  arrivalRadiusNM: number,
): SandboxRoute | null {
  if (!chime || state.type !== "route") return null;
  return {
    waypoints: state.route.waypoints.map(({ lat, lon, name }) => ({
      lat,
      lon,
      name,
    })),
    legIndex: state.legIndex,
    arrivalRadiusNM,
  };
}

export function startNativeRouteWatch(
  activeNav: ActiveNavigationManager,
  onFollowing: (following: boolean) => void,
): void {
  if (Capacitor.getPlatform() !== "android") return;
  // What was last sent, compared by identity: the nav subscription fires on
  // every fix, and the route rarely changes.
  let sent: unknown[] | null = null;
  const sync = () => {
    const state = activeNav.getState();
    const { waypointArrivalAlert, arrivalRadiusNM, gpsSource } = getSettings();
    const source = routeWatchSource(gpsSource);
    const key = [
      state.type === "route" ? state.route : null,
      state.type === "route" ? state.legIndex : null,
      waypointArrivalAlert,
      arrivalRadiusNM,
      source,
    ];
    if (sent?.every((v, i) => v === key[i])) return;
    sent = key;
    const route = source
      ? sandboxRouteFor(state, waypointArrivalAlert, arrivalRadiusNM)
      : null;
    BackgroundGPS.setRouteWatch({ route, source: source ?? "device" }).then(
      () => onFollowing(route !== null),
      () => {
        // An older native shell without the method: no background chime.
      },
    );
  };
  activeNav.subscribe(sync);
  onSettingsChange(sync);
  sync();
}
