/**
 * Spatial + temporal cache for wind samples.
 *
 * Wind barbs are fetched on a fixed geographic "master" lattice whose spacing
 * is independent of zoom (`MASTER_LON_STEP` x `MASTER_LAT_STEP`, pinned at the
 * old zoom-12 density — about 1.7 km, well inside any forecast model's cell
 * size, so finer sampling would be pure waste). At a given display zoom, the
 * fetched/cached lattice is a subset of the master lattice (every `stride`-th
 * point); coarser zooms select a sparser subset, but the *keys* are always the
 * master-lattice indices, so every zoom shares one cache — zooming in and out
 * never refetches a physical location that's already cached.
 *
 * Each sample carries a timestamp; samples older than the TTL are refetched.
 * The cache is bounded (oldest-out) so it can't grow without limit.
 */

/**
 * Hourly wind forecast series for one lattice point. One entry covers the whole
 * forecast window, so a single fetch serves every time-bar offset; `sampleAt`
 * picks the hour for the current display time.
 */
export interface WindSample {
  /** Epoch ms of hourly[0] (top of the run's first hour). */
  baseMs: number;
  /** Wind speed (knots) per hour; index = whole hours after `baseMs`. */
  speed: number[];
  /** Direction (degrees the wind comes FROM) per hour, parallel to `speed`. */
  dir: number[];
}

interface CacheEntry {
  sample: WindSample;
  lon: number;
  lat: number;
  t: number; // epoch ms when fetched
}

const HOUR_MS = 3_600_000;

/**
 * Resolve an hourly series to a single (speed, dir) at `atMs`, choosing the
 * nearest hour. Returns null when `atMs` is outside the series window. Picks the
 * nearest hour rather than interpolating — direction wraps at 360° and barbs are
 * quantized to 5 kt buckets anyway, so sub-hour blending buys nothing.
 */
export function sampleAt(
  s: WindSample,
  atMs: number,
): { speed: number; dir: number } | null {
  const h = Math.round((atMs - s.baseMs) / HOUR_MS);
  if (h < 0 || h >= s.speed.length) return null;
  return { speed: s.speed[h], dir: s.dir[h] };
}

export interface LatticePoint {
  /** Stable, zoom-independent key: `${iLon}:${iLat}` (master lattice index). */
  key: string;
  lon: number;
  lat: number;
}

/**
 * Display lattice spacing in degrees at an integer zoom. Purely a rendering
 * density — the bases are tuned so a typical viewport shows roughly the old
 * 10x7 grid's density, and halving per zoom keeps on-screen barb spacing
 * ~constant. Longitude is spaced wider than latitude because viewports are
 * wider than tall. This has no lower bound by design: above zoom 12 barbs are
 * drawn at this (finer) density but interpolated from the coarser master
 * lattice below (see `bilinearWind` in wind-interp.ts) — only the *display*
 * density increases, not the number of API locations fetched.
 */
const LON_STEP_BASE = 128;
const LAT_STEP_BASE = 64;

/** The zoom at which the display lattice equals the master (fetch) lattice. */
export const MASTER_ZOOM = 12;

export function lonStep(zoom: number): number {
  return LON_STEP_BASE / 2 ** zoom;
}
export function latStep(zoom: number): number {
  return LAT_STEP_BASE / 2 ** zoom;
}

/**
 * Master lattice spacing — the finest the API is ever sampled at, regardless
 * of display zoom (~1.74 km in latitude). Chosen to match zoom 12's density,
 * which was already fine enough for any forecast model's cell size.
 */
export const MASTER_LON_STEP = lonStep(MASTER_ZOOM);
export const MASTER_LAT_STEP = latStep(MASTER_ZOOM);

/**
 * At display zoom `z`, the API/cache lattice keeps every `stride`-th master
 * point. For z <= 12 this reproduces the old per-zoom spacing exactly
 * (stride halves as zoom increases); above 12 the stride is 1 — the master
 * lattice is already the finest we ever fetch.
 */
export function strideForZoom(zoom: number): number {
  return 2 ** Math.max(0, MASTER_ZOOM - Math.round(zoom));
}

/**
 * The API/fetch lattice points covering a bounding box at the given display
 * zoom: every `stride`-th master-lattice point whose cell intersects the
 * viewport, plus one ring beyond each edge so bilinear interpolation at the
 * viewport's boundary always has all 4 corners available. Capped for safety
 * (an unusually large viewport at low zoom); the cap drops outer points rather
 * than coarsening, so kept points keep their stable keys.
 */
export function selectApiPoints(
  west: number,
  east: number,
  south: number,
  north: number,
  zoom: number,
  maxPoints = 160,
): LatticePoint[] {
  const stride = strideForZoom(zoom);
  const i0 = Math.floor(west / MASTER_LON_STEP / stride) * stride;
  const i1 = Math.ceil(east / MASTER_LON_STEP / stride) * stride;
  const j0 = Math.floor(south / MASTER_LAT_STEP / stride) * stride;
  const j1 = Math.ceil(north / MASTER_LAT_STEP / stride) * stride;
  const points: LatticePoint[] = [];
  for (let j = j0; j <= j1; j += stride) {
    for (let i = i0; i <= i1; i += stride) {
      points.push({
        key: `${i}:${j}`,
        lon: i * MASTER_LON_STEP,
        lat: j * MASTER_LAT_STEP,
      });
      if (points.length >= maxPoints) return points;
    }
  }
  return points;
}

/**
 * Display (barb-drawing) positions inside a bounding box at the given zoom —
 * used above zoom 12, where barbs are drawn denser than the master lattice and
 * each position's wind is bilinearly interpolated from the surrounding master
 * points (see wind-interp.ts). At zoom <= 12 this is unused: display points
 * are exactly the selected API points, with no interpolation.
 */
export function displayLatticePointsInBounds(
  west: number,
  east: number,
  south: number,
  north: number,
  zoom: number,
  maxPoints = 160,
): Array<{ lon: number; lat: number }> {
  const sx = lonStep(zoom);
  const sy = latStep(zoom);
  const i0 = Math.ceil(west / sx);
  const i1 = Math.floor(east / sx);
  const j0 = Math.ceil(south / sy);
  const j1 = Math.floor(north / sy);
  const points: Array<{ lon: number; lat: number }> = [];
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      points.push({ lon: i * sx, lat: j * sy });
      if (points.length >= maxPoints) return points;
    }
  }
  return points;
}

export class WindCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ttlMs: number, maxEntries: number) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  /** The series for this key (any age), or undefined. */
  get(key: string): WindSample | undefined {
    return this.entries.get(key)?.sample;
  }

  /** Whether a non-stale sample exists for this key. */
  isFresh(key: string, now: number): boolean {
    const e = this.entries.get(key);
    return !!e && now - e.t < this.ttlMs;
  }

  /** Store/refresh a sample. Re-inserting moves it to most-recent (LRU order). */
  put(
    key: string,
    lon: number,
    lat: number,
    sample: WindSample,
    now: number,
  ): void {
    this.entries.delete(key);
    this.entries.set(key, { sample, lon, lat, t: now });
    if (this.entries.size > this.maxEntries) {
      // Map preserves insertion order; oldest put is first.
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  /** Drop expired entries (call occasionally to release memory). */
  prune(now: number): void {
    for (const [k, e] of this.entries) {
      if (now - e.t >= this.ttlMs) this.entries.delete(k);
    }
  }

  /**
   * Split lattice points into those that still need fetching (missing or stale)
   * and render-ready samples for everything we already have (fresh OR stale, so
   * a revisited-but-aging area shows barbs immediately while it refreshes).
   */
  partition(
    points: LatticePoint[],
    now: number,
  ): {
    need: LatticePoint[];
    have: Array<LatticePoint & { sample: WindSample }>;
  } {
    const need: LatticePoint[] = [];
    const have: Array<LatticePoint & { sample: WindSample }> = [];
    for (const p of points) {
      const e = this.entries.get(p.key);
      if (e) have.push({ ...p, sample: e.sample });
      if (!e || now - e.t >= this.ttlMs) need.push(p);
    }
    return { need, have };
  }

  get size(): number {
    return this.entries.size;
  }
}
