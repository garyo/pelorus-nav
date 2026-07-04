/**
 * Dim overlay layers (routes, waypoints, bearing line, plotting) in
 * night/dusk themes so user overlays don't glare against the darkened chart.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import { getSettings, onSettingsChange } from "../settings";

const NIGHT_OPACITY = 0.45;
const DUSK_OPACITY = 0.7;

export function installOverlayDimming(map: MapLibreMap): void {
  // Settings fire ~8×/s during slider drags and most changes don't touch the
  // theme — skip the full layer sweep (and its styledata churn) when the
  // theme is unchanged. Style reloads reset paint properties, so the
  // style.load path clears the memo to force a re-apply.
  let appliedTheme: string | null = null;

  const applyOverlayDimming = (theme: string): void => {
    if (theme === appliedTheme) return;
    if (!map.isStyleLoaded()) return;
    appliedTheme = theme;

    const opacity =
      theme === "night" ? NIGHT_OPACITY : theme === "dusk" ? DUSK_OPACITY : 1;

    for (const layer of map.getStyle().layers) {
      const id = layer.id;
      const isOverlay =
        id.startsWith("_route-line-") ||
        id.startsWith("_route-labels-") ||
        id === "_bearing-line-layer" ||
        id === "_bearing-line-target" ||
        id.startsWith("_plot-");

      if (!isOverlay) continue;

      if (layer.type === "line") {
        map.setPaintProperty(id, "line-opacity", opacity * 0.9);
      } else if (layer.type === "circle") {
        map.setPaintProperty(id, "circle-opacity", opacity);
        map.setPaintProperty(id, "circle-stroke-opacity", opacity);
      } else if (layer.type === "symbol") {
        map.setPaintProperty(id, "text-opacity", opacity);
      }
    }

    // Symbol layers (route points, waypoint points) use icon-opacity
    for (const id of ["_waypoints-points", "_waypoints-labels"]) {
      if (map.getLayer(id)) {
        map.setPaintProperty(id, "icon-opacity", opacity);
        map.setPaintProperty(id, "text-opacity", opacity);
      }
    }
    for (const layer of map.getStyle().layers) {
      if (layer.id.startsWith("_route-points-") && layer.type === "symbol") {
        map.setPaintProperty(layer.id, "icon-opacity", opacity);
      }
    }
  };

  // Apply on theme change and after style reloads (when layers are re-added)
  onSettingsChange((s) => applyOverlayDimming(s.displayTheme));
  map.on("style.load", () => {
    // Defer until layers are re-added after style load
    map.once("idle", () => {
      appliedTheme = null; // fresh style — paint properties were reset
      applyOverlayDimming(getSettings().displayTheme);
    });
  });
}
