/**
 * Waypoint marker scale — the "Waypoint size" settings slider.
 * Layers that draw waypoints (WaypointLayer, RouteLayer, RouteEditor)
 * multiply their base icon sizes (and label offsets — name labels keep the
 * standard text size) by this, and re-apply live via onWaypointScaleChange
 * (the layers survive style rebuilds, so a settings subscription is the one
 * reliable update path).
 */

import { getSettings, onSettingsChange } from "../settings";

export function getWaypointScale(): number {
  return getSettings().waypointScale;
}

/**
 * Invoke `apply` whenever the waypoint-size setting changes (not initially —
 * layer creation reads getWaypointScale() itself). Returns an unsubscribe.
 */
export function onWaypointScaleChange(
  apply: (scale: number) => void,
): () => void {
  let prev = getSettings().waypointScale;
  return onSettingsChange((s) => {
    if (s.waypointScale === prev) return;
    prev = s.waypointScale;
    apply(s.waypointScale);
  });
}
