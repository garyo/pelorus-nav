/**
 * Keeps the Android background service's copy of the active route current,
 * so it can chime as waypoints are passed while the app is frozen (see
 * route-sandbox.ts). Sends the route and leg whenever either changes, and
 * nothing — clearing the service's copy — when not following a route or when
 * the waypoint chime is turned off.
 */

import { Capacitor } from "@capacitor/core";
import { BackgroundGPS } from "../plugins/BackgroundGPS";
import { getSettings, onSettingsChange } from "../settings";
import type {
  ActiveNavigationManager,
  ActiveNavigationState,
} from "./ActiveNavigation";
import type { SandboxRoute } from "./route-sandbox";

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
): void {
  if (Capacitor.getPlatform() !== "android") return;
  // What was last sent, compared by identity: the nav subscription fires on
  // every fix, and the route rarely changes.
  let sent: unknown[] | null = null;
  const sync = () => {
    const state = activeNav.getState();
    const { waypointArrivalAlert, arrivalRadiusNM } = getSettings();
    const key = [
      state.type === "route" ? state.route : null,
      state.type === "route" ? state.legIndex : null,
      waypointArrivalAlert,
      arrivalRadiusNM,
    ];
    if (sent?.every((v, i) => v === key[i])) return;
    sent = key;
    const route = sandboxRouteFor(state, waypointArrivalAlert, arrivalRadiusNM);
    BackgroundGPS.setRouteWatch({ route }).catch(() => {
      // An older native shell without the method: no background chime.
    });
  };
  activeNav.subscribe(sync);
  onSettingsChange(sync);
  sync();
}
