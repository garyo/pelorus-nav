/**
 * Weather overlay — OpenWeatherMap raster tiles.
 *
 * Renders a user-selected OWM layer (wind / temperature / precipitation /
 * clouds / pressure) as a raster layer in the `overlay-data` slot, using the
 * user's API key from plugin settings. Tiles are fetched and cached through the
 * host's tile-cache facet (offline-capable). Opacity and layer are live plugin
 * settings; a missing key renders nothing (transparent tiles, no errors).
 */

import type { RasterTileSource } from "maplibre-gl";
import type { LegendSpec } from "../legend";
import type { MapOverlay, PluginHost, PluginMap } from "../types";

const SOURCE_ID = "_wx-owm";
const LAYER_ID = "_wx-owm-layer";
export const WEATHER_LAYER_GROUP = "weather";

/**
 * OWM's free (1.0) tiles are translucent and low-saturation by design, so they
 * wash out over the busy nautical chart. Boost saturation/contrast so the field
 * reads clearly; opacity (user-tunable) balances visibility against seeing the
 * chart through it. Richer rendering (bold fill, wind arrows) needs OWM's paid
 * 2.0 Maps API.
 */
const RASTER_SATURATION = 0.7;
const RASTER_CONTRAST = 0.3;
const DEFAULT_OPACITY = 0.7;

/** Display key → OpenWeatherMap layer id. (Wind is a separate plugin.) */
const OWM_LAYERS: Record<string, string> = {
  temp: "temp_new",
  precipitation: "precipitation_new",
  clouds: "clouds_new",
  pressure: "pressure_new",
};

/**
 * Legend color scales, matching OWM's documented 1.0 tile palettes
 * (openweathermap.org/map_legend). Wind is converted to the user's speed unit;
 * temperature is shown in °F. Stops are low → high.
 */
const LEGENDS: Record<string, (host: PluginHost) => LegendSpec> = {
  temp: () => ({
    title: "Temp (°F)",
    stops: [
      { color: "rgb(32,140,236)", label: "-4" }, // -20°C
      { color: "rgb(35,221,221)", label: "32" }, //   0°C
      { color: "rgb(194,255,40)", label: "50" }, //  10°C
      { color: "rgb(255,240,40)", label: "68" }, //  20°C
      { color: "rgb(252,128,20)", label: "86" }, //  30°C
    ],
  }),
  precipitation: () => ({
    title: "Precip (mm)",
    stops: [
      { color: "rgba(110,110,205,0.5)", label: "1" },
      { color: "rgba(80,80,225,0.8)", label: "10" },
      { color: "rgba(20,20,255,1)", label: "140" },
    ],
  }),
  clouds: () => ({
    title: "Clouds (%)",
    stops: [
      { color: "rgba(200,200,220,0.3)", label: "25" },
      { color: "rgba(230,230,245,0.6)", label: "60" },
      { color: "rgba(245,245,255,0.95)", label: "100" },
    ],
  }),
  pressure: () => ({
    title: "Pressure (hPa)",
    stops: [
      { color: "rgb(0,115,255)", label: "940" },
      { color: "rgb(141,231,199)", label: "1000" },
      { color: "rgb(176,247,32)", label: "1010" },
      { color: "rgb(251,85,21)", label: "1040" },
      { color: "rgb(198,0,0)", label: "1080" },
    ],
  }),
};

export class WeatherOverlay implements MapOverlay {
  readonly id = "weather";

  private readonly host: PluginHost;
  private pmap: PluginMap | null = null;
  private readonly tilesTemplate: (rest: string) => string;
  private enabled: boolean;
  private lastLayer: string;
  private lastOpacity: number;
  private lastKey: string;
  /** Bumped when the API key changes, to bust MapLibre's per-URL tile cache. */
  private keyNonce = 0;

  constructor(host: PluginHost) {
    this.host = host;
    const cache = host.data.registerTileCache({
      scheme: "owmtiles",
      cacheName: "wx-owm-v1",
      maxAgeMs: 60 * 60 * 1000, // weather is time-sensitive — 1h
      upstream: (z, x, y, rest) => {
        const key = host.settings.getOwn<string>("apiKey");
        if (!key) return null; // no key yet → transparent tile
        const layer = rest.split("/")[0]; // rest = "<layer>/<nonce>"
        return `https://tile.openweathermap.org/map/${layer}/${z}/${x}/${y}.png?appid=${key}`;
      },
    });
    this.tilesTemplate = cache.template;

    this.enabled = host.settings.isLayerGroupEnabled(WEATHER_LAYER_GROUP);
    this.lastLayer = this.owmLayer();
    this.lastOpacity = this.opacity();
    this.lastKey = host.settings.getOwn<string>("apiKey") ?? "";

    // Plugin-owned settings (layer, opacity, key) changed.
    host.settings.onOwnChange(() => this.onOwnSettingsChanged());
    // The layer-group toggle is a core setting; speed-unit changes relabel the
    // wind legend — both arrive via onChange.
    host.settings.onChange(() => {
      const now = host.settings.isLayerGroupEnabled(WEATHER_LAYER_GROUP);
      if (now !== this.enabled) {
        this.enabled = now;
        this.applyVisibility();
      }
      this.updateLegend();
    });
  }

  private selectedKey(): string {
    return this.host.settings.getOwn<string>("layer") ?? "temp";
  }

  private owmLayer(): string {
    return OWM_LAYERS[this.selectedKey()] ?? OWM_LAYERS.temp;
  }

  /** Show the active layer's color legend, or clear it when disabled. */
  private updateLegend(): void {
    if (!this.enabled) {
      this.host.ui.setLegend(null);
      return;
    }
    const build = LEGENDS[this.selectedKey()] ?? LEGENDS.temp;
    this.host.ui.setLegend(build(this.host));
  }

  private opacity(): number {
    const o = this.host.settings.getOwn<number>("opacity");
    return typeof o === "number" ? o : DEFAULT_OPACITY;
  }

  private template(): string {
    return this.tilesTemplate(`${this.owmLayer()}/${this.keyNonce}`);
  }

  setup(map: PluginMap): void {
    this.pmap = map;
    map.addSource(SOURCE_ID, {
      type: "raster",
      tiles: [this.template()],
      tileSize: 256,
      attribution: "© OpenWeatherMap",
    });
    map.addLayer(
      {
        id: LAYER_ID,
        type: "raster",
        source: SOURCE_ID,
        layout: { visibility: this.enabled ? "visible" : "none" },
        paint: {
          "raster-opacity": this.lastOpacity,
          "raster-saturation": RASTER_SATURATION,
          "raster-contrast": RASTER_CONTRAST,
        },
      },
      "overlay-data",
    );
  }

  update(): void {
    this.enabled = this.host.settings.isLayerGroupEnabled(WEATHER_LAYER_GROUP);
    this.applyVisibility();
    this.updateLegend();
  }

  private applyVisibility(): void {
    const map = this.pmap?.raw;
    if (map?.getLayer(LAYER_ID)) {
      map.setLayoutProperty(
        LAYER_ID,
        "visibility",
        this.enabled ? "visible" : "none",
      );
    }
  }

  private onOwnSettingsChanged(): void {
    const map = this.pmap?.raw;
    if (!map) return;

    const op = this.opacity();
    if (op !== this.lastOpacity && map.getLayer(LAYER_ID)) {
      this.lastOpacity = op;
      map.setPaintProperty(LAYER_ID, "raster-opacity", op);
    }

    const key = this.host.settings.getOwn<string>("apiKey") ?? "";
    const layer = this.owmLayer();
    let refresh = false;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.keyNonce++; // bust per-URL tile cache so tiles refetch with the key
      refresh = true;
    }
    if (layer !== this.lastLayer) {
      this.lastLayer = layer;
      refresh = true;
    }
    if (refresh) {
      const src = map.getSource(SOURCE_ID) as RasterTileSource | undefined;
      src?.setTiles([this.template()]);
      this.updateLegend(); // layer change → different scale
    }
  }
}
