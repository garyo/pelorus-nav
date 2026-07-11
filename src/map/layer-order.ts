/**
 * Overlay z-order helper. The vessel must draw above route/waypoint overlays;
 * VesselLayer raises itself once per style load, but overlays added *after*
 * that (loading a route, editing waypoints) would otherwise land on top of
 * the boat. Overlays pass this as `beforeId` so they always insert beneath
 * the vessel stack — and when the vessel layers don't exist yet, appending
 * is fine because the vessel is raised when it appears.
 */

/** The lowest vessel layer currently in the style, if any. */
export function belowVesselLayerId(map: {
  getLayer(id: string): unknown;
}): string | undefined {
  for (const id of [
    "_vessel-accuracy-fill",
    "_vessel-accuracy-outline",
    "_vessel-icon",
  ]) {
    if (map.getLayer(id)) return id;
  }
  return undefined;
}
