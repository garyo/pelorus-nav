/**
 * Weather — first-party plugin (OpenWeatherMap).
 *
 * Exercises the SDK paths Tides didn't: a host-managed cached tile protocol
 * (`host.data.registerTileCache`) and plugin-owned settings including a user
 * secret (the OWM API key), all declared via the manifest's `settingsSchema`
 * and rendered by the host.
 */

import { PLUGIN_API_VERSION, type Plugin } from "../types";
import { WeatherOverlay } from "./WeatherOverlay";

export const weatherPlugin: Plugin = {
  manifest: {
    id: "app.pelorus.weather",
    name: "Weather",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    description:
      "OpenWeatherMap raster overlays (wind, temperature, precipitation, …).",
    author: "Pelorus Nav",
    capabilities: ["map.overlay", "data.network", "settings"],
    layerGroups: [{ id: "weather", label: "Weather", default: false }],
    settingsSchema: [
      {
        key: "apiKey",
        label: "OWM API key",
        type: "text",
        secret: true,
        placeholder: "OpenWeatherMap API key",
      },
      {
        // Wind has its own plugin (Open-Meteo barbs); OWM covers the rest.
        key: "layer",
        label: "Layer",
        type: "select",
        default: "temp",
        options: [
          { value: "temp", label: "Temperature" },
          { value: "precipitation", label: "Precipitation" },
          { value: "clouds", label: "Clouds" },
          { value: "pressure", label: "Pressure" },
        ],
      },
      {
        key: "opacity",
        label: "Opacity",
        type: "slider",
        default: 0.7,
        min: 0,
        max: 1,
        step: 0.05,
        format: (v) => `${Math.round(v * 100)}%`,
      },
    ],
  },

  activate(host) {
    const overlay = new WeatherOverlay(host);
    host.overlays.register(overlay);
  },
};
