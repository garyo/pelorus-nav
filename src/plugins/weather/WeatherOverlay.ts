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
import type { MapOverlay, PluginHost, PluginMap } from "../types";

const SOURCE_ID = "_wx-owm";
const LAYER_ID = "_wx-owm-layer";
export const WEATHER_LAYER_GROUP = "weather";

/** Display key → OpenWeatherMap layer id. */
const OWM_LAYERS: Record<string, string> = {
  wind: "wind_new",
  temp: "temp_new",
  precipitation: "precipitation_new",
  clouds: "clouds_new",
  pressure: "pressure_new",
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
    // The layer-group toggle is a core setting.
    host.settings.onChange(() => {
      const now = host.settings.isLayerGroupEnabled(WEATHER_LAYER_GROUP);
      if (now !== this.enabled) {
        this.enabled = now;
        this.applyVisibility();
      }
    });
  }

  private owmLayer(): string {
    const sel = this.host.settings.getOwn<string>("layer") ?? "wind";
    return OWM_LAYERS[sel] ?? OWM_LAYERS.wind;
  }

  private opacity(): number {
    const o = this.host.settings.getOwn<number>("opacity");
    return typeof o === "number" ? o : 0.8;
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
        paint: { "raster-opacity": this.lastOpacity },
      },
      "overlay-data",
    );
  }

  update(): void {
    this.enabled = this.host.settings.isLayerGroupEnabled(WEATHER_LAYER_GROUP);
    this.applyVisibility();
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
    }
  }
}
