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
 * After a rate-limit (HTTP 429 / error body) back off this long before trying
 * again. Open-Meteo weights each request by location count, so the grid is
 * "expensive" — backing off keeps us from hammering an exhausted quota.
 */
const RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000;
/**
 * Coarse-snap cache: don't re-fetch until the map centre has moved more than
 * this fraction of the viewport (or the zoom bucket changed). Small pans reuse
 * the existing barbs — they're still valid wind data at their locations — so a
 * user lingering over a harbour spends one fetch, not one per nudge. The grid
 * density (and so on-screen barb spacing) is unchanged.
 */
const SNAP_FRACTION = 0.4;

type WindStatus = "ok" | "loading" | "rate-limited" | "no-data" | "off";

interface FetchAnchor {
  lng: number;
  lat: number;
  zoomBucket: number;
}

/**
 * Whether a fetch can be skipped because the view hasn't moved enough to need
 * fresh barbs. Pure so it's unit-testable without a live map.
 */
export function canReuseGrid(
  prev: FetchAnchor | null,
  cur: FetchAnchor,
  viewportDeg: { width: number; height: number },
  hasData: boolean,
  snapFraction = SNAP_FRACTION,
): boolean {
  if (!hasData || !prev) return false;
  if (prev.zoomBucket !== cur.zoomBucket) return false;
  return (
    Math.abs(cur.lng - prev.lng) < viewportDeg.width * snapFraction &&
    Math.abs(cur.lat - prev.lat) < viewportDeg.height * snapFraction
  );
}

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
  /** Centre + zoom bucket of the last successful fetch (coarse-snap cache). */
  private lastAnchor: FetchAnchor | null = null;
  /** Last successful grid, re-applied instantly when the style rebuilds (which
   * wipes the source) so barbs don't blink out on every layer/settings toggle. */
  private lastData: FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };
  /** Epoch ms before which we won't hit the API again (rate-limit backoff). */
  private rateLimitUntil = 0;
  private status: WindStatus = "off";

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
        if (now) {
          this.fetchGrid();
        } else {
          this.clear();
          this.refreshStatus(); // remove the status chip
        }
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
    // Seed with the last good grid so barbs reappear immediately after a style
    // rebuild instead of blinking out until the next fetch returns.
    map.addSource(SOURCE_ID, { type: "geojson", data: this.lastData });
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
    // Keep lastFetchKey across rebuilds: with the cached grid re-seeded above,
    // the post-setup update() must NOT re-fetch an unchanged viewport (that's
    // what was burning the API quota on every layer toggle).
  }

  update(): void {
    this.enabled = this.host.settings.isLayerGroupEnabled(WIND_LAYER_GROUP);
    this.applyVisibility();
    if (this.enabled) this.fetchGrid();
    else this.refreshStatus();
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
    this.lastAnchor = null;
    this.lastData = { type: "FeatureCollection", features: [] };
    const src = this.pmap?.raw.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    src?.setData(this.lastData);
  }

  /** Map current state to the host-rendered status chip (cleared when fine). */
  private setStatus(status: WindStatus): void {
    this.status = status;
    this.refreshStatus();
  }

  private refreshStatus(): void {
    let text: string | null = null;
    if (this.enabled) {
      if (this.status === "loading") text = "Wind: loading…";
      else if (this.status === "rate-limited")
        text = "Wind: rate-limited — retrying soon";
      else if (this.status === "no-data") text = "Wind: no data here";
      // "ok" / "off" → no chip; the barbs (or their absence) speak for themselves.
    }
    this.host.ui.setStatus(text);
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
      this.setStatus("off");
      return;
    }
    const b = map.getBounds();
    const w = b.getWest();
    const e = b.getEast();
    const s = b.getSouth();
    const n = b.getNorth();

    // Coarse-snap cache: reuse the current barbs for small pans / zoom nudges so
    // we don't spend an API call per move. Also makes style rebuilds (layer
    // toggles) free, since the centre hasn't moved. Checked before the backoff
    // so nudging around existing barbs never flips the status to "rate-limited".
    const center = map.getCenter();
    const anchor: FetchAnchor = {
      lng: center.lng,
      lat: center.lat,
      zoomBucket: Math.round(map.getZoom()),
    };
    if (
      !force &&
      canReuseGrid(
        this.lastAnchor,
        anchor,
        { width: e - w, height: n - s },
        this.lastData.features.length > 0,
      )
    ) {
      return;
    }

    if (Date.now() < this.rateLimitUntil) {
      this.setStatus("rate-limited");
      return; // still backing off; keep last-known barbs
    }

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
    if (!this.lastData.features.length) this.setStatus("loading");

    const url =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${lats.join(",")}&longitude=${lons.join(",")}` +
      "&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn";
    let data: unknown;
    try {
      const resp = await fetch(url);
      // 429 (and Open-Meteo's quota errors) → back off and tell the user, rather
      // than silently retrying an exhausted quota on every pan.
      if (resp.status === 429) throw new Error("rate-limited");
      if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status}`);
      data = await resp.json();
    } catch (err) {
      this.rateLimitUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
      this.setStatus("rate-limited");
      console.warn("wind fetch failed:", err);
      return; // keep last-known barbs
    }
    // A non-array body is Open-Meteo's `{error:true,reason}` (e.g. quota) — also
    // a reason to back off.
    if (!Array.isArray(data)) {
      this.rateLimitUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
      this.setStatus("rate-limited");
      return;
    }
    this.lastAnchor = anchor;
    const grid = data as Array<{
      current?: { wind_speed_10m?: number; wind_direction_10m?: number };
    }>;

    const features: Feature[] = [];
    for (let i = 0; i < grid.length; i++) {
      const cur = grid[i]?.current;
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
    this.lastData = fc;
    const src = map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    src?.setData(fc);
    this.setStatus(features.length ? "ok" : "no-data");
  }
}
