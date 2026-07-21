/**
 * Wind overlay — Open-Meteo wind barbs.
 *
 * Renders meteorological wind barbs on a grid covering the visible map: the
 * staff points toward the wind source (the "from" direction), and feathers
 * encode speed (half-barb 5 kt, full barb 10 kt, pennant 50 kt). One
 * deliberate departure from the WMO glyph: the downwind end carries a small
 * dart instead of the station circle — these are forecast grid points, not
 * stations, and the arrow-flying-with-the-wind metaphor is unambiguous.
 * Barbs are drawn white with a black halo so they stay visible over a busy
 * chart in any theme. Data is fetched keyless from Open-Meteo (best-match of
 * GFS/HRRR/ECMWF/ICON), already in knots.
 */

import type { Feature, FeatureCollection } from "geojson";
import type * as maplibregl from "maplibre-gl";
import type { MapOverlay, PluginHost, PluginMap } from "../types";
import {
  displayLatticePointsInBounds,
  type LatticePoint,
  MASTER_LAT_STEP,
  MASTER_LON_STEP,
  MASTER_ZOOM,
  sampleAt,
  selectApiPoints,
  WindCache,
  type WindSample,
} from "./wind-cache";
import { InFlightTracker } from "./wind-inflight";
import { bilinearWind, type WindVector } from "./wind-interp";
import { isConnectivityError } from "./wind-net";

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
/** How long the "needs Internet" notice stays up before self-hiding — it's a
 *  transient reminder, not a persistent banner (a later refresh re-shows it). */
const OFFLINE_CHIP_MS = 6 * 1000;

type WindStatus =
  | "ok"
  | "loading"
  | "rate-limited"
  | "offline"
  | "no-data"
  | "off";

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
  // wind source). The staff points the way the wind comes from; the downwind
  // end carries a small dart. (North wind ⇒ feathers on top, dart below.)
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

  // Downwind dart in place of the WMO station circle: an arrow flies WITH
  // the wind, so the tip marks where the wind is going — the circle read
  // ambiguously (a weathervane of that shape points INTO the wind). Tip 3.2
  // units downwind of the station, wings raked back, slightly concave
  // leading edges. Footprint matches the old dot + halo.
  const dart = () => {
    ctx.beginPath();
    ctx.moveTo(0, 3.2);
    ctx.quadraticCurveTo(0.7, -0.2, 2.6, -2.2);
    ctx.lineTo(0, -0.9);
    ctx.lineTo(-2.6, -2.2);
    ctx.quadraticCurveTo(-0.7, -0.2, 0, 3.2);
    ctx.closePath();
  };

  const pass = (
    lw: number,
    color: string,
    fill: boolean,
    dartHaloW: number,
  ) => {
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
    dart();
    if (dartHaloW > 0) {
      ctx.lineWidth = dartHaloW;
      ctx.stroke();
    }
    ctx.fill();
  };
  pass(3.4, "rgba(0,0,0,0.85)", false, 2.2); // black halo + dart backing
  pass(1.5, "#ffffff", true, 0); // white barb + dart

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
  /** Lattice keys with a fetch in flight, so overlapping refreshes don't
   * re-request the same missing points while a slow fetch is pending. */
  private readonly inFlight = new InFlightTracker();
  /** Epoch ms before which we won't hit the API again (rate-limit backoff). */
  private rateLimitUntil = 0;
  private status: WindStatus = "off";
  /** Timer that self-hides the transient "needs Internet" chip. */
  private offlineChipTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (this.offlineChipTimer) {
      clearTimeout(this.offlineChipTimer);
      this.offlineChipTimer = null;
    }
    let text: string | null = null;
    if (this.enabled) {
      if (this.status === "loading") text = "Wind: loading…";
      else if (this.status === "rate-limited")
        text = "Wind: rate-limited — retrying soon";
      else if (this.status === "offline")
        text = "Wind barbs need Internet connectivity";
      else if (this.status === "no-data") text = "Wind: no data here";
      // "ok" / "off" → no chip; the barbs (or their absence) speak for themselves.
    }
    this.host.ui.setStatus(text);
    // The connectivity notice self-hides so it doesn't linger; staying offline
    // just re-shows it on the next refresh.
    if (text && this.status === "offline") {
      this.offlineChipTimer = setTimeout(() => {
        this.offlineChipTimer = null;
        this.host.ui.setStatus(null);
      }, OFFLINE_CHIP_MS);
    }
  }

  private scheduleRefresh(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.refresh(), 150);
  }

  /**
   * Re-evaluate the visible lattice: render whatever we already have (so a
   * revisit shows barbs instantly), then fetch only the points that are missing
   * or stale — reusing the cache everywhere else. Points already being fetched
   * by an in-flight request are excluded, so an overlapping refresh (e.g. from
   * continued panning) doesn't duplicate that request.
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
    const points = selectApiPoints(
      b.getWest(),
      b.getEast(),
      b.getSouth(),
      b.getNorth(),
      zoom,
    );

    // Paint cached barbs (fresh or stale) right away — no blink on revisit.
    const { need, have } = this.cache.partition(points, now);
    const atMs = this.host.time.now().getTime();
    this.setData(this.render(zoom, b, atMs));

    const toFetch = this.inFlight.filterNew(need);
    if (toFetch.length === 0) {
      this.setStatus(have.length ? "ok" : "no-data");
      return;
    }
    if (now < this.rateLimitUntil) {
      // Can't fetch the new points yet; keep the cached barbs we just drew.
      this.setStatus(have.length ? "ok" : "rate-limited");
      return;
    }
    if (have.length === 0) this.setStatus("loading");

    this.inFlight.begin(toFetch);
    let samples: Array<{ point: LatticePoint; sample: WindSample }> | null;
    try {
      samples = await this.fetchPoints(toFetch);
    } finally {
      this.inFlight.end(toFetch);
    }
    if (!samples) return; // fetch failed; backoff + status already set
    for (const { point, sample } of samples) {
      this.cache.put(point.key, point.lon, point.lat, sample, Date.now());
    }
    this.cache.prune(Date.now());

    // Repaint against the map's *current* view — it may have moved during the
    // await, and rendering the bounds captured above would overwrite a newer
    // refresh's paint with a stale viewport.
    const after = this.cache.partition(points, Date.now());
    this.setData(
      this.render(
        Math.round(map.getZoom()),
        map.getBounds(),
        this.host.time.now().getTime(),
      ),
    );
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
    this.setData(this.render(zoom, b, this.host.time.now().getTime()));
  }

  /**
   * Render barbs for the current view. At zoom <= MASTER_ZOOM the display
   * points ARE the selected API points (identical to the pre-interpolation
   * behaviour). Above MASTER_ZOOM, barbs are drawn at the finer per-zoom
   * display density and each one's (speed, dir) is bilinearly interpolated
   * from the 4 surrounding master-lattice samples, so visual density keeps
   * increasing with zoom without fetching any more API locations.
   */
  private render(
    zoom: number,
    b: maplibregl.LngLatBounds,
    atMs: number,
  ): FeatureCollection {
    const west = b.getWest();
    const east = b.getEast();
    const south = b.getSouth();
    const north = b.getNorth();

    if (zoom <= MASTER_ZOOM) {
      const points = selectApiPoints(west, east, south, north, zoom);
      const features: Feature[] = [];
      for (const p of points) {
        const sample = this.cache.get(p.key);
        const s = sample && sampleAt(sample, atMs);
        if (!s) continue; // missing or outside the forecast window — skip
        features.push(this.feature(p.lon, p.lat, s));
      }
      return { type: "FeatureCollection", features };
    }

    const features: Feature[] = [];
    for (const dp of displayLatticePointsInBounds(
      west,
      east,
      south,
      north,
      zoom,
    )) {
      const iLon = dp.lon / MASTER_LON_STEP;
      const iLat = dp.lat / MASTER_LAT_STEP;
      const i0 = Math.floor(iLon);
      const j0 = Math.floor(iLat);
      const v = bilinearWind(
        [
          this.cornerAt(i0, j0, atMs),
          this.cornerAt(i0 + 1, j0, atMs),
          this.cornerAt(i0, j0 + 1, atMs),
          this.cornerAt(i0 + 1, j0 + 1, atMs),
        ],
        iLon - i0,
        iLat - j0,
      );
      if (!v) continue; // all 4 corners missing/stale-out-of-window
      features.push(this.feature(dp.lon, dp.lat, v));
    }
    return { type: "FeatureCollection", features };
  }

  /** The wind at master-lattice index (i, j) at `atMs`, or null if uncached
   * or outside its series window. */
  private cornerAt(i: number, j: number, atMs: number): WindVector | null {
    const sample = this.cache.get(`${i}:${j}`);
    return sample ? sampleAt(sample, atMs) : null;
  }

  private feature(
    lon: number,
    lat: number,
    s: { speed: number; dir: number },
  ): Feature {
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        barb: imageId(barbBucket(s.speed)),
        dir: Math.round(s.dir),
      },
    };
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
      // Airplane mode / no Internet: this is a connectivity problem, not a
      // quota one — say so, and don't arm the long rate-limit backoff so barbs
      // return promptly once we reconnect.
      if (isConnectivityError(err, navigator.onLine)) {
        this.setStatus("offline");
        console.warn("wind fetch failed (offline):", err);
        return null;
      }
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
    // Pair strictly by index, which only works if the response has exactly
    // one entry per requested point — Open-Meteo always should, but never
    // guess-pair a short/long response onto the wrong locations. Take the
    // common prefix instead; this isn't a rate-limit/quota condition, so it
    // doesn't arm the backoff.
    if (list.length !== points.length) {
      console.warn(
        `wind fetch: requested ${points.length} points, got ${list.length}; using common prefix`,
      );
    }
    const n = Math.min(list.length, points.length);
    const out: Array<{ point: LatticePoint; sample: WindSample }> = [];
    for (let i = 0; i < n; i++) {
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
