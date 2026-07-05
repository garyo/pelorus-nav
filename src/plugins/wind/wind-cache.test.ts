import { describe, expect, it } from "vitest";
import {
  displayLatticePointsInBounds,
  type LatticePoint,
  latStep,
  lonStep,
  MASTER_LAT_STEP,
  MASTER_LON_STEP,
  sampleAt,
  selectApiPoints,
  strideForZoom,
  WindCache,
  type WindSample,
} from "./wind-cache";

const HOUR = 3_600_000;
/** Build an hourly series starting at `baseMs`. */
const series = (
  baseMs: number,
  speed: number[],
  dir: number[],
): WindSample => ({
  baseMs,
  speed,
  dir,
});

describe("display lattice spacing", () => {
  it("halves per zoom level", () => {
    expect(lonStep(11)).toBeCloseTo(lonStep(10) / 2);
    expect(latStep(11)).toBeCloseTo(latStep(10) / 2);
  });
});

describe("selectApiPoints", () => {
  it("gives a point in two overlapping viewports the SAME key", () => {
    // This is the property that makes pan-away-and-back reuse work.
    const a = selectApiPoints(-71, -70, 42, 43, 10);
    const b = selectApiPoints(-70.5, -69.5, 42.2, 43.2, 10);
    const overlap = a.filter((p) => b.some((q) => q.key === p.key));
    expect(overlap.length).toBeGreaterThan(0);
    // Coordinates for a shared key are identical (pinned to geography).
    for (const p of overlap) {
      const q = b.find((x) => x.key === p.key) as LatticePoint;
      expect(q.lon).toBeCloseTo(p.lon);
      expect(q.lat).toBeCloseTo(p.lat);
    }
  });

  it("keys are zoom-independent: a coarser zoom's selection is a subset of a finer one's", () => {
    // Bounds chosen as exact multiples of the zoom-10 (coarsest here) step so
    // the outward floor/ceil rounding lands on the same master index at every
    // zoom in between — otherwise the coarser lattice's one-ring overhang can
    // land half a step outside the finer lattice's range at the edge.
    // Small enough (in stride10 units) that neither selection below hits the
    // default 160-point cap, which would otherwise truncate the finer (z12)
    // set and make it look smaller than the coarser (z11) one.
    const stride10 = strideForZoom(10);
    const west = -20 * MASTER_LON_STEP * stride10;
    const east = west + 2 * MASTER_LON_STEP * stride10;
    const south = 10 * MASTER_LAT_STEP * stride10;
    const north = south + 2 * MASTER_LAT_STEP * stride10;

    const z11 = selectApiPoints(west, east, south, north, 11);
    const z12 = selectApiPoints(west, east, south, north, 12);
    expect(z11.length).toBeGreaterThan(0);
    for (const p of z11) {
      expect(z12.some((q) => q.key === p.key)).toBe(true);
    }

    // z=15 stays at master resolution — identical selection to z=12.
    const z15 = selectApiPoints(west, east, south, north, 15);
    expect(z15.map((p) => p.key).sort()).toEqual(z12.map((p) => p.key).sort());
  });

  it("never samples finer than the master lattice (~1.74 km) at zoom >= 12", () => {
    for (const zoom of [12, 13, 15, 18]) {
      const pts = selectApiPoints(-71, -70, 42, 43, zoom);
      const lats = [...new Set(pts.map((p) => p.lat))].sort((a, b) => a - b);
      for (let i = 1; i < lats.length; i++) {
        expect(lats[i] - lats[i - 1]).toBeCloseTo(MASTER_LAT_STEP);
      }
    }
  });

  it("covers a viewport strictly inside one master cell with that cell's 4 corners", () => {
    // A tiny viewport that sits fully inside master cell (i0, j0)..(i0+1, j0+1)
    // must still return all 4 corners so bilinear interpolation has data — the
    // old inward-snapping lattice returned zero points here.
    const i0 = 100;
    const j0 = 50;
    const west = i0 * MASTER_LON_STEP + MASTER_LON_STEP * 0.3;
    const east = i0 * MASTER_LON_STEP + MASTER_LON_STEP * 0.7;
    const south = j0 * MASTER_LAT_STEP + MASTER_LAT_STEP * 0.3;
    const north = j0 * MASTER_LAT_STEP + MASTER_LAT_STEP * 0.7;

    const pts = selectApiPoints(west, east, south, north, 12);
    expect(pts.length).toBe(4);
    const keys = pts.map((p) => p.key).sort();
    expect(keys).toEqual(
      [
        `${i0}:${j0}`,
        `${i0 + 1}:${j0}`,
        `${i0}:${j0 + 1}`,
        `${i0 + 1}:${j0 + 1}`,
      ].sort(),
    );
  });

  it("caps the number of points", () => {
    const pts = selectApiPoints(-180, 180, -85, 85, 4, 50);
    expect(pts.length).toBe(50);
  });
});

describe("displayLatticePointsInBounds", () => {
  it("halves spacing per zoom level, matching lonStep/latStep", () => {
    const pts = displayLatticePointsInBounds(-71, -70, 42, 43, 13);
    const lons = [...new Set(pts.map((p) => p.lon))].sort((a, b) => a - b);
    if (lons.length > 1) {
      expect(lons[1] - lons[0]).toBeCloseTo(lonStep(13));
    }
  });
});

describe("sampleAt", () => {
  const s = series(1_000_000, [10, 12, 14], [90, 100, 110]);

  it("returns the hour at baseMs (index 0)", () => {
    expect(sampleAt(s, 1_000_000)).toEqual({ speed: 10, dir: 90 });
  });

  it("indexes whole hours after baseMs", () => {
    expect(sampleAt(s, 1_000_000 + HOUR)).toEqual({ speed: 12, dir: 100 });
    expect(sampleAt(s, 1_000_000 + 2 * HOUR)).toEqual({ speed: 14, dir: 110 });
  });

  it("rounds to the nearest hour", () => {
    expect(sampleAt(s, 1_000_000 + 0.4 * HOUR)).toEqual({ speed: 10, dir: 90 });
    expect(sampleAt(s, 1_000_000 + 0.6 * HOUR)).toEqual({
      speed: 12,
      dir: 100,
    });
  });

  it("returns null outside the series window", () => {
    expect(sampleAt(s, 1_000_000 - HOUR)).toBeNull(); // before
    expect(sampleAt(s, 1_000_000 + 3 * HOUR)).toBeNull(); // past the end
  });
});

describe("WindCache", () => {
  const ttl = 1000;

  it("stores and retrieves the series; isFresh respects the TTL", () => {
    const c = new WindCache(ttl, 100);
    c.put("k", -70, 42, series(0, [12], [270]), 0);
    expect(c.get("k")).toEqual({ baseMs: 0, speed: [12], dir: [270] });
    expect(c.isFresh("k", 500)).toBe(true);
    expect(c.isFresh("k", 1500)).toBe(false); // older than TTL
    expect(c.isFresh("missing", 0)).toBe(false);
  });

  it("evicts the oldest entry past the cap", () => {
    const c = new WindCache(ttl, 2);
    c.put("a", 0, 0, series(0, [1], [0]), 0);
    c.put("b", 0, 0, series(0, [2], [0]), 1);
    c.put("c", 0, 0, series(0, [3], [0]), 2); // evicts "a"
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBeDefined();
    expect(c.get("c")).toBeDefined();
    expect(c.size).toBe(2);
  });

  it("prune drops only stale entries", () => {
    const c = new WindCache(ttl, 100);
    c.put("old", 0, 0, series(0, [1], [0]), 0);
    c.put("new", 0, 0, series(0, [2], [0]), 900);
    c.prune(1200); // "old" is 1200ms (stale), "new" is 300ms (fresh)
    expect(c.get("old")).toBeUndefined();
    expect(c.get("new")).toBeDefined();
  });

  it("partition fetches only missing/stale points and reuses fresh ones", () => {
    const c = new WindCache(ttl, 100);
    const pts = selectApiPoints(-71, -70, 42, 43, 10);
    expect(pts.length).toBeGreaterThan(2);
    // Cache the first point fresh, the second stale, leave the rest missing.
    c.put(pts[0].key, pts[0].lon, pts[0].lat, series(0, [10], [90]), 950);
    c.put(pts[1].key, pts[1].lon, pts[1].lat, series(0, [20], [180]), 0);
    const { need, have } = c.partition(pts, 1000);

    // Fresh point is not re-fetched; stale + missing are.
    expect(need.some((p) => p.key === pts[0].key)).toBe(false);
    expect(need.some((p) => p.key === pts[1].key)).toBe(true);
    expect(need.length).toBe(pts.length - 1);

    // Both cached points (fresh and stale) are render-ready immediately.
    expect(
      have.some((p) => p.key === pts[0].key && p.sample.speed[0] === 10),
    ).toBe(true);
    expect(
      have.some((p) => p.key === pts[1].key && p.sample.speed[0] === 20),
    ).toBe(true);
  });

  it("needs everything when the cache is empty", () => {
    const c = new WindCache(ttl, 100);
    const pts = selectApiPoints(-71, -70, 42, 43, 10);
    const { need, have } = c.partition(pts, 0);
    expect(need.length).toBe(pts.length);
    expect(have.length).toBe(0);
  });
});
