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
import {
  type LatticePoint,
  latticePointsInBounds,
  sampleAt,
  WindCache,
  type WindSample,
} from "./wind-cache";

const SOURCE_ID = "_wind-om";
const LAYER_ID = "_wind-om-layer";
export const WIND_LAYER_GROUP = "wind";

const MIN_ZOOM = 4;
/** How often to re-evaluate the view and refresh any TTL-stale visible barbs. */
const REFRESH_MS = 5 * 60 * 1000;
/** Samples older than this are refetched; revisits within it are free. */
const CACHE_TTL_MS = 30 * 60 * 1000;
/**
 * Bounded cache. Each entry now holds a multi-day hourly series (one fetch
 * serves every time-bar offset), so far fewer entries are needed than when
 * each held a single snapshot.
 */
const CACHE_MAX = 1500;
/**
 * After a rate-limit (HTTP 429 / error body) back off this long before trying
 * again. Open-Meteo weights each request by location count, so a request is
 * "expensive" — backing off keeps us from hammering an exhausted quota.
 */
const RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000;

type WindStatus = "ok" | "loading" | "rate-limited" | "no-data" | "off";

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
  /** Wind samples pinned to a fixed geographic lattice, with per-sample TTL. */
  private readonly cache = new WindCache(CACHE_TTL_MS, CACHE_MAX);
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
      if (this.enabled) this.scheduleRefresh();
    }, 500);
    host.events.onTimeTick(() => {
      if (this.enabled) this.scheduleRefresh();
    }, REFRESH_MS);
    // Time-bar offset changes: re-pick the forecast hour from cached series and
    // repaint — no refetch (the series already spans the whole window).
    host.time.onChange(() => {
      if (this.enabled) this.reindex();
    });
    host.settings.onChange(() => {
      const now = host.settings.isLayerGroupEnabled(WIND_LAYER_GROUP);
      if (now !== this.enabled) {
        this.enabled = now;
        this.applyVisibility();
        if (now) {
          this.scheduleRefresh();
        } else {
          this.refreshStatus(); // remove the status chip; cache is kept
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
  }

  update(): void {
    this.enabled = this.host.settings.isLayerGroupEnabled(WIND_LAYER_GROUP);
    this.applyVisibility();
    if (this.enabled) this.scheduleRefresh();
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

  private setData(fc: FeatureCollection): void {
    const src = this.pmap?.raw.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    src?.setData(fc);
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

  private scheduleRefresh(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.refresh(), 150);
  }

  /**
   * Re-evaluate the visible lattice: render whatever we already have (so a
   * revisit shows barbs instantly), then fetch only the points that are missing
   * or stale — reusing the cache everywhere else.
   */
  private async refresh(): Promise<void> {
    const map = this.pmap?.raw;
    if (!map || !this.enabled) return;
    if (map.getZoom() < MIN_ZOOM) {
      this.setData({ type: "FeatureCollection", features: [] });
      this.setStatus("off");
      return;
    }
    const b = map.getBounds();
    const zoom = Math.round(map.getZoom());
    const now = Date.now();
    const points = latticePointsInBounds(
      b.getWest(),
      b.getEast(),
      b.getSouth(),
      b.getNorth(),
      zoom,
    );

    // Paint cached barbs (fresh or stale) right away — no blink on revisit.
    const { need, have } = this.cache.partition(points, now);
    const atMs = this.host.time.now().getTime();
    this.setData(this.toFeatures(have, atMs));

    if (need.length === 0) {
      this.setStatus(have.length ? "ok" : "no-data");
      return;
    }
    if (now < this.rateLimitUntil) {
      // Can't fetch the new points yet; keep the cached barbs we just drew.
      this.setStatus(have.length ? "ok" : "rate-limited");
      return;
    }
    if (have.length === 0) this.setStatus("loading");

    const samples = await this.fetchPoints(need);
    if (!samples) return; // fetch failed; backoff + status already set
    for (const { point, sample } of samples) {
      this.cache.put(point.key, point.lon, point.lat, sample, Date.now());
    }
    this.cache.prune(Date.now());

    // Re-partition (the view may have moved during the await) and repaint.
    const after = this.cache.partition(points, Date.now());
    this.setData(this.toFeatures(after.have, this.host.time.now().getTime()));
    this.setStatus(after.have.length ? "ok" : "no-data");
  }

  /**
   * Re-pick the forecast hour for the current display time from cached series
   * and repaint, without any network fetch. Used when the time-bar offset moves.
   */
  private reindex(): void {
    const map = this.pmap?.raw;
    if (!map || !this.enabled || map.getZoom() < MIN_ZOOM) return;
    const b = map.getBounds();
    const zoom = Math.round(map.getZoom());
    const points = latticePointsInBounds(
      b.getWest(),
      b.getEast(),
      b.getSouth(),
      b.getNorth(),
      zoom,
    );
    const { have } = this.cache.partition(points, Date.now());
    this.setData(this.toFeatures(have, this.host.time.now().getTime()));
  }

  private toFeatures(
    have: Array<LatticePoint & { sample: WindSample }>,
    atMs: number,
  ): FeatureCollection {
    const features: Feature[] = [];
    for (const p of have) {
      const s = sampleAt(p.sample, atMs);
      if (!s) continue; // outside the forecast window — skip
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: {
          barb: imageId(barbBucket(s.speed)),
          dir: Math.round(s.dir),
        },
      });
    }
    return { type: "FeatureCollection", features };
  }

  /**
   * Fetch wind for exactly the given lattice points in one Open-Meteo request.
   * Returns the parsed samples, or null on a rate-limit/error (after arming the
   * backoff + status). Open-Meteo returns an object for one point, an array for
   * many; both are normalised here.
   */
  private async fetchPoints(
    points: LatticePoint[],
  ): Promise<Array<{ point: LatticePoint; sample: WindSample }> | null> {
    const lats = points.map((p) => p.lat.toFixed(3)).join(",");
    const lons = points.map((p) => p.lon.toFixed(3)).join(",");
    // Hourly series (not just `current`) so a single fetch covers every
    // time-bar offset. forecast_days=3 = 72 hourly slots from 00:00 UTC today,
    // which always spans now…now+48h (current UTC hour ≤ 23, +48 ≤ 71).
    // unixtime gives epoch seconds directly (no timezone parsing).
    const url =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${lats}&longitude=${lons}` +
      "&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn" +
      "&forecast_days=3&timeformat=unixtime";
    let data: unknown;
    try {
      const resp = await fetch(url);
      // 429 (and Open-Meteo's quota errors) → back off and tell the user.
      if (resp.status === 429) throw new Error("rate-limited");
      if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status}`);
      data = await resp.json();
    } catch (err) {
      this.rateLimitUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
      this.setStatus("rate-limited");
      console.warn("wind fetch failed:", err);
      return null;
    }
    if (data && typeof data === "object" && "error" in data) {
      // `{error:true,reason}` — quota or bad request; back off.
      this.rateLimitUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
      this.setStatus("rate-limited");
      return null;
    }
    const list = Array.isArray(data) ? data : [data];
    const out: Array<{ point: LatticePoint; sample: WindSample }> = [];
    for (let i = 0; i < points.length; i++) {
      const hourly = (
        list[i] as
          | {
              hourly?: {
                time?: number[];
                wind_speed_10m?: number[];
                wind_direction_10m?: number[];
              };
            }
          | undefined
      )?.hourly;
      if (
        hourly?.time?.length &&
        hourly.wind_speed_10m &&
        hourly.wind_direction_10m
      ) {
        out.push({
          point: points[i],
          sample: {
            baseMs: hourly.time[0] * 1000,
            speed: hourly.wind_speed_10m,
            dir: hourly.wind_direction_10m,
          },
        });
      }
    }
    return out;
  }
}
