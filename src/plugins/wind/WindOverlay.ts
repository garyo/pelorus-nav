/**
 * Wind overlay — Open-Meteo wind barbs.
 *
 * Renders wind as colored direction arrows on a grid covering the visible map.
 * Direction comes from rotation (arrows point downwind, the way the wind
 * blows); speed is colored on a blue→green→yellow→red ramp capped at 30 kt
 * (anything faster is bright red). Data is fetched keyless from Open-Meteo
 * (best-match of GFS/HRRR/ECMWF/ICON), already in knots. A matching legend is
 * shown via the host's legend facet.
 */

import type { Feature, FeatureCollection } from "geojson";
import type maplibregl from "maplibre-gl";
import type { LegendSpec } from "../legend";
import type { MapOverlay, PluginHost, PluginMap } from "../types";

const SOURCE_ID = "_wind-om";
const LAYER_ID = "_wind-om-layer";
export const WIND_LAYER_GROUP = "wind";

/** Grid density over the viewport (cols × rows); kept small to fit one request. */
const COLS = 10;
const ROWS = 7;
const MIN_ZOOM = 4;
/** Refresh cadence — wind changes slowly, and the API is rate-limited. */
const REFRESH_MS = 15 * 60 * 1000;

/** Speed buckets (kt) → blue→green→yellow→red ramp; last bucket (≥30) is red. */
const BUCKETS = [5, 10, 15, 20, 25, 30];
const COLORS = [
  "#4a90e2", // 0–5  blue
  "#45c4b0", // 5–10 teal
  "#5fd35f", // 10–15 green
  "#c9e34b", // 15–20 lime
  "#ffd23f", // 20–25 yellow
  "#ff8c42", // 25–30 orange
  "#ff3b30", // ≥30  red
];

interface ArrowImg {
  width: number;
  height: number;
  data: Uint8Array;
  pixelRatio: number;
}

function imageId(i: number): string {
  return `_wind-arrow-${i}`;
}

/** Draw an upward-pointing filled arrow of the given color as an ImageData. */
function arrowImage(color: string): ArrowImg {
  const s = 28;
  const px = 2;
  const canvas = document.createElement("canvas");
  canvas.width = s * px;
  canvas.height = s * px;
  const ctx = canvas.getContext("2d");
  if (!ctx)
    return { width: 1, height: 1, data: new Uint8Array(4), pixelRatio: 1 };
  ctx.scale(px, px);
  ctx.translate(s / 2, s / 2);
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 0.75;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(0, -12); // tip (north)
  ctx.lineTo(6, -3);
  ctx.lineTo(2, -3);
  ctx.lineTo(2, 11);
  ctx.lineTo(-2, 11);
  ctx.lineTo(-2, -3);
  ctx.lineTo(-6, -3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const img = ctx.getImageData(0, 0, s * px, s * px);
  return {
    width: img.width,
    height: img.height,
    data: new Uint8Array(img.data.buffer),
    pixelRatio: px,
  };
}

/** icon-image step expression: pick the arrow color by speed bucket. */
function iconExpr(): unknown {
  const expr: unknown[] = ["step", ["get", "speed"], imageId(0)];
  BUCKETS.forEach((b, i) => {
    expr.push(b, imageId(i + 1));
  });
  return expr;
}

export class WindOverlay implements MapOverlay {
  readonly id = "wind";

  private readonly host: PluginHost;
  private pmap: PluginMap | null = null;
  private readonly arrows: ArrowImg[];
  private enabled: boolean;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private lastFetchKey = "";

  constructor(host: PluginHost) {
    this.host = host;
    this.arrows = COLORS.map(arrowImage);
    this.enabled = host.settings.isLayerGroupEnabled(WIND_LAYER_GROUP);

    host.events.onMapMove(() => {
      if (this.enabled) this.fetchGrid();
    }, 500);
    host.events.onTimeTick(() => {
      if (this.enabled) this.fetchGrid(true);
    }, REFRESH_MS);
    host.settings.onChange(() => {
      const now = host.settings.isLayerGroupEnabled(WIND_LAYER_GROUP);
      if (now !== this.enabled) {
        this.enabled = now;
        this.applyVisibility();
        this.updateLegend();
        if (now) this.fetchGrid();
        else this.clear();
      }
    });
  }

  setup(map: PluginMap): void {
    this.pmap = map;
    for (let i = 0; i < this.arrows.length; i++) {
      const id = imageId(i);
      if (!map.raw.hasImage(id)) {
        const a = this.arrows[i];
        map.raw.addImage(
          id,
          { width: a.width, height: a.height, data: a.data },
          { pixelRatio: a.pixelRatio },
        );
      }
    }
    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer(
      {
        id: LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        minzoom: MIN_ZOOM,
        layout: {
          visibility: this.enabled ? "visible" : "none",
          "icon-image": iconExpr() as never,
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-size": 1,
        },
      },
      "overlay-data",
    );
    this.lastFetchKey = "";
  }

  update(): void {
    this.enabled = this.host.settings.isLayerGroupEnabled(WIND_LAYER_GROUP);
    this.applyVisibility();
    this.updateLegend();
    if (this.enabled) this.fetchGrid();
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

  private clear(): void {
    this.lastFetchKey = "";
    const src = this.pmap?.raw.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    src?.setData({ type: "FeatureCollection", features: [] });
  }

  private fetchGrid(force = false): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.doFetch(force), 150);
  }

  private async doFetch(force: boolean): Promise<void> {
    const map = this.pmap?.raw;
    if (!map || !this.enabled) return;
    if (map.getZoom() < MIN_ZOOM) {
      this.clear();
      return;
    }
    const b = map.getBounds();
    const w = b.getWest();
    const e = b.getEast();
    const s = b.getSouth();
    const n = b.getNorth();
    // Inset slightly so arrows aren't clipped at the edges.
    const dx = (e - w) / COLS;
    const dy = (n - s) / ROWS;
    const lats: number[] = [];
    const lons: number[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        lats.push(Number((s + dy * (r + 0.5)).toFixed(2)));
        lons.push(Number((w + dx * (c + 0.5)).toFixed(2)));
      }
    }
    // Skip refetch if the grid (rounded) hasn't changed and not forced.
    const key = `${lats[0]},${lons[0]},${lats[lats.length - 1]},${lons[lons.length - 1]}`;
    if (!force && key === this.lastFetchKey) return;
    this.lastFetchKey = key;

    const url =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${lats.join(",")}&longitude=${lons.join(",")}` +
      "&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn";
    let data: Array<{
      current?: { wind_speed_10m?: number; wind_direction_10m?: number };
    }>;
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status}`);
      data = await resp.json();
    } catch (err) {
      console.warn("wind fetch failed:", err);
      return; // keep last-known arrows
    }
    if (!Array.isArray(data)) return;

    const features: Feature[] = [];
    for (let i = 0; i < data.length; i++) {
      const cur = data[i]?.current;
      if (
        !cur ||
        cur.wind_speed_10m == null ||
        cur.wind_direction_10m == null
      ) {
        continue;
      }
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lons[i], lats[i]] },
        properties: {
          speed: Number(cur.wind_speed_10m.toFixed(1)),
          // Arrow points downwind (the way the wind blows). API gives "from".
          bearing: Math.round((cur.wind_direction_10m + 180) % 360),
        },
      });
    }
    const fc: FeatureCollection = { type: "FeatureCollection", features };
    const src = map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    src?.setData(fc);
  }

  private updateLegend(): void {
    if (!this.enabled) {
      this.host.ui.setLegend(null);
      return;
    }
    const labels = ["0", "5", "10", "15", "20", "25", "30+"];
    const spec: LegendSpec = {
      title: "Wind (kt)",
      stops: COLORS.map((color, i) => ({ color, label: labels[i] })),
    };
    this.host.ui.setLegend(spec);
  }
}
