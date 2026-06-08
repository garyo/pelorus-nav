/**
 * Tides & Currents — first-party plugin.
 *
 * Bundles the offline harmonic prediction core (src/tides/) into a map overlay,
 * a Layers toggle, a downloadable data asset, and a station-popup pickable —
 * all through the plugin host. The proof that the plugin contract can fully
 * absorb an existing feature with no loss of behavior.
 */

import { PLUGIN_API_VERSION, type Plugin } from "../types";
import { TIDES_PICK_LAYERS, TidesOverlay } from "./TidesOverlay";

export const tidesPlugin: Plugin = {
  manifest: {
    id: "app.pelorus.tides",
    name: "Tides & Currents",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    description:
      "Offline tide and tidal-current predictions from bundled NOAA harmonics.",
    author: "Pelorus Nav",
    capabilities: ["map.overlay", "data.network", "settings"],
    layerGroups: [
      { id: "tidesCurrents", label: "Tides & Currents", default: false },
    ],
    dataAssets: [
      {
        id: "tides-bundle",
        label: "Tide & Current Stations",
        url: "/tides-stations.json",
        filename: "tides-stations.json",
        sizeEstimate: 1.65 * 1024 * 1024,
      },
    ],
  },

  activate(host) {
    const overlay = new TidesOverlay(host);
    host.overlays.register(overlay);
    host.picking.register({
      layers: TIDES_PICK_LAYERS,
      resolve: (feature) => overlay.resolveInfo(feature),
    });
    return { deactivate: () => overlay.destroy() };
  },
};
