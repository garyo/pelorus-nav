/**
 * Wind overlay — Open-Meteo wind barbs.
 *
 * Renders standard meteorological wind barbs on a grid covering the visible
 * map: the staff points toward the wind source (the "from" direction), and
 * feathers encode speed (half-barb 5 kt, full barb 10 kt, pennant 50 kt). Barbs
 * are drawn white with a black halo so they stay visible over a busy chart in
 * any theme. Data is fetched keyless from Open-Meteo (best-match of
 * GFS/HRRR/ECMWF/ICON), already in knots.
 */

import type { Feature, FeatureCollection } from "geojson";
import type maplibregl from "maplibre-gl";
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

/**
 * Barb images are pre-rendered at 5 kt increments up to this cap. 70 kt covers
 * realistic marine winds with a pennant (50) plus barbs (e.g. 65 = pennant +
 * full + half); stronger winds clamp to this.
 */
const MAX_BARB_KT = 70;
const BARB_STEP_KT = 5;

function imageId(kt: number): string {
  return `_wind-barb-${kt}`;
}

/** Round a speed to the nearest pre-rendered barb bucket. */
function barbBucket(kt: number): number {
  const r = Math.round(kt / BARB_STEP_KT) * BARB_STEP_KT;
  return Math.max(0, Math.min(MAX_BARB_KT, r));
}

interface BarbImg {
  width: number;
  height: number;
  data: Uint8Array;
  pixelRatio: number;
}

/**
 * Draw a wind barb for `speed` kt. The station (plot point) is at the tile
 * centre — MapLibre's default rotation anchor — so the barb pivots about the
 * station, with the staff extending up (toward the wind source) and feathers at
 * the upwind end. White fill/stroke over a black halo for visibility. The tile
 * is sized so feathers + halo never clip; on-screen size is set by icon-size.
 */
function barbImage(speed: number): BarbImg {
  const s = 64;
  const px = 2;
  const canvas = document.createElement("canvas");
  canvas.width = s * px;
  canvas.height = s * px;
  const ctx = canvas.getContext("2d");
  if (!ctx)
    return { width: 1, height: 1, data: new Uint8Array(4), pixelRatio: 1 };
  ctx.scale(px, px);
  ctx.translate(s / 2, s / 2); // origin = station = rotation anchor

  const botY = 0; // station end (pivot)
  const topY = -26; // upwind tip
  const lines: [number, number, number, number][] = [];
  const flags: Array<[number, number][]> = [];

  let flagN = Math.floor(speed / 50);
  let rem = speed % 50;
  let fullN = Math.floor(rem / 10);
  rem %= 10;
  const halfN = rem >= 5 ? 1 : 0;

  // Feathers sit at the upwind tip and point away from the station (toward the
  // wind source). The staff points the way the wind comes from; the station dot
  // is the downwind end. (North wind ⇒ feathers on top, dot on the bottom.)
  // Feathers are on the right of the staff (Northern Hemisphere convention).
  let y = topY + 2; // first feather just inside the tip
  for (; flagN > 0; flagN--) {
    flags.push([
      [0, y],
      [12, y - 3],
      [0, y + 5],
    ]);
    y += 8;
  }
  // A lone half-barb is set in from the tip per convention.
  if (fullN === 0 && halfN === 1 && flags.length === 0) y += 4;
  for (; fullN > 0; fullN--) {
    lines.push([0, y, 11, y - 5]);
    y += 5;
  }
  if (halfN) lines.push([0, y, 6, y - 2.5]);
  lines.push([0, botY, 0, topY]); // staff

  const pass = (lw: number, color: string, fill: boolean, dotR: number) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const [x1, y1, x2, y2] of lines) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    for (const tri of flags) {
      ctx.beginPath();
      ctx.moveTo(tri[0][0], tri[0][1]);
      ctx.lineTo(tri[1][0], tri[1][1]);
      ctx.lineTo(tri[2][0], tri[2][1]);
      ctx.closePath();
      if (fill) ctx.fill();
      else ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, dotR, 0, Math.PI * 2);
    ctx.fill();
  };
  pass(3.4, "rgba(0,0,0,0.85)", false, 2.6); // black halo + station dot
  pass(1.5, "#ffffff", true, 1.4); // white barb + station dot

  const img = ctx.getImageData(0, 0, s * px, s * px);
  return {
    width: img.width,
    height: img.height,
    data: new Uint8Array(img.data.buffer),
    pixelRatio: px,
  };
}

export class WindOverlay implements MapOverlay {
  readonly id = "wind";

  private readonly host: PluginHost;
  private pmap: PluginMap | null = null;
  /** Pre-rendered barb images keyed by bucket speed (0,5,…,MAX). */
  private readonly barbs = new Map<number, BarbImg>();
  private enabled: boolean;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private lastFetchKey = "";

  constructor(host: PluginHost) {
    this.host = host;
    for (let kt = 0; kt <= MAX_BARB_KT; kt += BARB_STEP_KT) {
      this.barbs.set(kt, barbImage(kt));
    }
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
        if (now) this.fetchGrid();
        else this.clear();
      }
    });
  }

  setup(map: PluginMap): void {
    this.pmap = map;
    for (const [kt, b] of this.barbs) {
      const id = imageId(kt);
      if (!map.raw.hasImage(id)) {
        map.raw.addImage(
          id,
          { width: b.width, height: b.height, data: b.data },
          { pixelRatio: b.pixelRatio },
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
          "icon-image": ["get", "barb"],
          "icon-rotate": ["get", "dir"], // staff toward the "from" direction
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-size": 0.9,
        },
      },
      "overlay-data",
    );
    this.lastFetchKey = "";
  }

  update(): void {
    this.enabled = this.host.settings.isLayerGroupEnabled(WIND_LAYER_GROUP);
    this.applyVisibility();
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
      return; // keep last-known barbs
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
          barb: imageId(barbBucket(cur.wind_speed_10m)),
          dir: Math.round(cur.wind_direction_10m),
        },
      });
    }
    const fc: FeatureCollection = { type: "FeatureCollection", features };
    const src = map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    src?.setData(fc);
  }
}
