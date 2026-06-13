/**
 * Sun Times — first-party plugin.
 *
 * Adds a Sun button to the top bar that opens a compact popup with sunrise,
 * sunset, and civil twilight for the next week at the chart-center location.
 * No map layer, no persistent screen real estate — and the first consumer of
 * the plugin host's `ui.registerAction` top-bar contribution.
 */

import { iconSun } from "../../ui/icons";
import { PLUGIN_API_VERSION, type Plugin } from "../types";
import { SunPanel } from "./SunPanel";

export const sunPlugin: Plugin = {
  manifest: {
    id: "app.pelorus.sun",
    name: "Sun Times",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    description:
      "Sunrise, sunset, and civil twilight for the next week, computed offline.",
    author: "Pelorus Nav",
    capabilities: [],
  },

  activate(host) {
    const panel = new SunPanel(host);
    const action = host.ui.registerAction({
      id: "sun-times",
      icon: iconSun,
      label: "SUN",
      title: "Sun & twilight times",
      fullLabel: "Sun Times",
      onSelect: () => panel.toggle(),
    });
    panel.onVisibilityChange = (open) => action.setActive(open);
    return { deactivate: () => panel.destroy() };
  },
};
