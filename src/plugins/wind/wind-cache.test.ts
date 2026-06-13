import { describe, expect, it } from "vitest";
import {
  type LatticePoint,
  latStep,
  latticePointsInBounds,
  lonStep,
  sampleAt,
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

describe("lattice spacing", () => {
  it("halves per zoom level", () => {
    expect(lonStep(11)).toBeCloseTo(lonStep(10) / 2);
    expect(latStep(11)).toBeCloseTo(latStep(10) / 2);
  });
});

describe("latticePointsInBounds", () => {
  it("gives a point in two overlapping viewports the SAME key", () => {
    // This is the property that makes pan-away-and-back reuse work.
    const a = latticePointsInBounds(-71, -70, 42, 43, 10);
    const b = latticePointsInBounds(-70.5, -69.5, 42.2, 43.2, 10);
    const overlap = a.filter((p) => b.some((q) => q.key === p.key));
    expect(overlap.length).toBeGreaterThan(0);
    // Coordinates for a shared key are identical (pinned to geography).
    for (const p of overlap) {
      const q = b.find((x) => x.key === p.key) as LatticePoint;
      expect(q.lon).toBeCloseTo(p.lon);
      expect(q.lat).toBeCloseTo(p.lat);
    }
  });

  it("different zooms use different keys", () => {
    const z10 = latticePointsInBounds(-71, -70, 42, 43, 10);
    const z11 = latticePointsInBounds(-71, -70, 42, 43, 11);
    expect(z10.some((p) => z11.some((q) => q.key === p.key))).toBe(false);
  });

  it("caps the number of points", () => {
    const pts = latticePointsInBounds(-180, 180, -85, 85, 4, 50);
    expect(pts.length).toBe(50);
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
    const pts = latticePointsInBounds(-71, -70, 42, 43, 10);
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
    const pts = latticePointsInBounds(-71, -70, 42, 43, 10);
    const { need, have } = c.partition(pts, 0);
    expect(need.length).toBe(pts.length);
    expect(have.length).toBe(0);
  });
});
