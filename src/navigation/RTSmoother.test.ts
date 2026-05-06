// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { TrackPoint } from "../data/Track";
import { loadTrackFixture } from "../data/test-fixtures";
import { smoothTrack } from "./RTSmoother";

const M_PER_DEG = 111_111;

/** Build a straight east-going track at the given step in metres. */
function straightLine(
  n: number,
  startLat = 42.0,
  startLon = -71.0,
  stepM = 5,
  intervalMs = 5000,
): TrackPoint[] {
  const cosLat = Math.cos((startLat * Math.PI) / 180);
  const lonStep = stepM / (M_PER_DEG * cosLat);
  return Array.from({ length: n }, (_, i) => ({
    lat: startLat,
    lon: startLon + i * lonStep,
    timestamp: i * intervalMs,
    sog: null,
    cog: null,
  }));
}

/** Median of an array. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** 95th percentile. */
function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.95)];
}

describe("smoothTrack — synthetic", () => {
  it("returns a clean straight line essentially unchanged", () => {
    const pts = straightLine(20);
    const r = smoothTrack(pts);
    expect(r.outliers).toEqual([]);
    // First point can be adjusted a few metres while the smoother resolves
    // the initial state covariance — interior points should be at-rest.
    const interior = r.shifts.slice(2, -2);
    expect(Math.max(...interior)).toBeLessThan(0.5);
  });

  it("flags a single injected outlier and the re-smoothed track interpolates cleanly", () => {
    const pts = straightLine(20);
    // Push one fix 100 m north — way off the east-going line.
    const badIdx = 10;
    pts[badIdx] = {
      ...pts[badIdx],
      lat: pts[badIdx].lat + 100 / M_PER_DEG,
    };
    const r = smoothTrack(pts);
    expect(r.outliers).toEqual([badIdx]);
    // The smoothed point at the outlier index keeps the raw position.
    expect(r.smoothed[badIdx].lat).toBeCloseTo(pts[badIdx].lat, 9);
    // Neighbours come back close to the true line (within 5 m of original).
    for (const i of [badIdx - 1, badIdx + 1]) {
      const dLatM = (r.smoothed[i].lat - pts[i].lat) * M_PER_DEG;
      expect(Math.abs(dLatM)).toBeLessThan(5);
    }
  });

  it("returns input unchanged for sub-threshold tracks", () => {
    const pts = straightLine(3);
    const r = smoothTrack(pts);
    expect(r.smoothed.map((p) => p.lat)).toEqual(pts.map((p) => p.lat));
    expect(r.smoothed.map((p) => p.lon)).toEqual(pts.map((p) => p.lon));
    expect(r.outliers).toEqual([]);
  });

  it("re-derives sog and cog from smoothed velocity", () => {
    // 5 m east per 5 s = 1 m/s = 1.94384 kn.
    const pts = straightLine(20, 42.0, -71.0, 5, 5000);
    const r = smoothTrack(pts);
    // Drop the first/last few points where the filter is converging or
    // the smoother lacks future/past context.
    const interior = r.smoothed.slice(5, 15);
    const sogs = interior.map((p) => p.sog ?? 0);
    expect(median(sogs)).toBeCloseTo(1.94384, 1);
    // East-going course → COG ≈ 90°.
    const cogs = interior.map((p) => p.cog ?? 0);
    expect(median(cogs)).toBeCloseTo(90, 0);
  });
});

describe("smoothTrack — fixtures", () => {
  it("clean walk has no outliers and small smoothing shift", () => {
    const pts = loadTrackFixture("Track 2026-05-06 10_59.gpx");
    const r = smoothTrack(pts);
    expect(r.outliers).toEqual([]);
    expect(median(r.shifts)).toBeLessThan(2);
    expect(p95(r.shifts)).toBeLessThan(6);
  });

  it("walk with one bad fix flags exactly that fix", () => {
    const pts = loadTrackFixture("Track 2026-05-06 16_38.gpx");
    const r = smoothTrack(pts);
    expect(r.outliers).toEqual([87]);
    // After dropping idx 87 the re-smoothed max shift drops below 15 m.
    const survivorShifts = r.shifts.filter((_, i) => i !== 87);
    expect(Math.max(...survivorShifts)).toBeLessThan(15);
    expect(median(r.shifts)).toBeLessThan(2);
  });

  it("noisy mixed-mode track does not flag statistical-tail samples", () => {
    const pts = loadTrackFixture("Track 2026-05-06 12_01.gpx");
    const r = smoothTrack(pts);
    // Threshold should scale up with the noisier shift distribution.
    expect(r.outlierThresholdM).toBeGreaterThan(20);
    expect(r.outliers).toEqual([]);
  });
});
