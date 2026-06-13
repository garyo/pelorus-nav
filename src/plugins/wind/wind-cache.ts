/**
 * Spatial + temporal cache for wind samples.
 *
 * Wind barbs are pinned to a fixed geographic lattice whose spacing depends only
 * on the integer zoom level — NOT on how the viewport happens to be framed. That
 * is the whole trick: the same location always maps to the same cache key no
 * matter where you've panned, so revisiting an area reuses its samples, and
 * panning across only needs to fetch the genuinely new points.
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
  /** Stable key: `${zoom}:${iLon}:${iLat}`. */
  key: string;
  lon: number;
  lat: number;
}

/**
 * Lattice spacing in degrees at an integer zoom. The bases are tuned so a
 * typical viewport shows roughly the old 10×7 grid's density, and halving per
 * zoom keeps on-screen barb spacing ~constant. Longitude is spaced wider than
 * latitude because viewports are wider than tall.
 */
const LON_STEP_BASE = 128;
const LAT_STEP_BASE = 64;

export function lonStep(zoom: number): number {
  return LON_STEP_BASE / 2 ** zoom;
}
export function latStep(zoom: number): number {
  return LAT_STEP_BASE / 2 ** zoom;
}

/**
 * The lattice points inside a bounding box at the given integer zoom. Capped for
 * safety (an unusually large viewport at low zoom); the cap drops outer points
 * rather than coarsening, so kept points keep their stable keys.
 */
export function latticePointsInBounds(
  west: number,
  east: number,
  south: number,
  north: number,
  zoom: number,
  maxPoints = 160,
): LatticePoint[] {
  const sx = lonStep(zoom);
  const sy = latStep(zoom);
  const i0 = Math.ceil(west / sx);
  const i1 = Math.floor(east / sx);
  const j0 = Math.ceil(south / sy);
  const j1 = Math.floor(north / sy);
  const points: LatticePoint[] = [];
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      points.push({ key: `${zoom}:${i}:${j}`, lon: i * sx, lat: j * sy });
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
