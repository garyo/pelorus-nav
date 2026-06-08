/**
 * Wind — first-party plugin (Open-Meteo wind barbs).
 *
 * Renders wind direction + speed as colored arrows, keyless. Exercises the SDK's
 * data path (a remote JSON grid fetch + a runtime-generated symbol image set)
 * and the legend facet — complementing the Weather plugin's tile-cache path.
 */

import { PLUGIN_API_VERSION, type Plugin } from "../types";
import { WindOverlay } from "./WindOverlay";

export const windPlugin: Plugin = {
  manifest: {
    id: "app.pelorus.wind",
    name: "Wind (Open-Meteo)",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    description:
      "Wind barbs (speed + direction) from Open-Meteo — keyless, GFS/HRRR/ECMWF.",
    author: "Pelorus Nav",
    capabilities: ["map.overlay", "data.network", "settings"],
    layerGroups: [{ id: "wind", label: "Wind", default: false }],
  },

  activate(host) {
    host.overlays.register(new WindOverlay(host));
  },
};
