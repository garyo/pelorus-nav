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

export interface WindSample {
  speed: number; // knots
  dir: number; // degrees the wind comes FROM
}

interface CacheEntry extends WindSample {
  lon: number;
  lat: number;
  t: number; // epoch ms when fetched
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

  /** A sample for this key (any age), or undefined. */
  get(key: string): WindSample | undefined {
    return this.entries.get(key);
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
    this.entries.set(key, { ...sample, lon, lat, t: now });
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
    have: Array<LatticePoint & WindSample>;
  } {
    const need: LatticePoint[] = [];
    const have: Array<LatticePoint & WindSample> = [];
    for (const p of points) {
      const sample = this.entries.get(p.key);
      if (sample) have.push({ ...p, speed: sample.speed, dir: sample.dir });
      if (!sample || now - sample.t >= this.ttlMs) need.push(p);
    }
    return { need, have };
  }

  get size(): number {
    return this.entries.size;
  }
}
