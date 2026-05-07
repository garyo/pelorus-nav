// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackPoint } from "../data/Track";
import { loadTrackFixture } from "../data/test-fixtures";
import type { NavigationData } from "./NavigationData";
import { smoothTrack } from "./RTSmoother";
import {
  type SimulatorErrorMode,
  SimulatorProvider,
} from "./SimulatorProvider";

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

/** Drive a SimulatorProvider for the requested number of ticks and
 *  return the captured fixes as TrackPoints. Uses fake timers so the
 *  test is deterministic and instant. */
function captureSimulatorFixes(
  ticks: number,
  errorMode: SimulatorErrorMode,
  intervalMs = 1000,
): TrackPoint[] {
  const sim = new SimulatorProvider({
    mode: "circular",
    center: [42.0, -71.0],
    radius: 0.2,
    speed: 6,
    intervalMs,
    errorMode,
    errorSeed: 42,
  });
  const captured: TrackPoint[] = [];
  sim.subscribe((data: NavigationData) => {
    captured.push({
      lat: data.latitude,
      lon: data.longitude,
      timestamp: data.timestamp,
      sog: data.sog,
      cog: data.cog,
    });
  });
  sim.connect(); // first tick fires synchronously
  for (let i = 1; i < ticks; i++) {
    vi.advanceTimersByTime(intervalMs);
  }
  sim.disconnect();
  return captured;
}

describe("smoothTrack — simulator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T20:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("with errorMode=none, smoother shifts stay small", () => {
    const fixes = captureSimulatorFixes(60, { kind: "none" });
    const r = smoothTrack(fixes);
    expect(r.outliers).toEqual([]);
    // Baseline jitter ~5m → smoothed shifts a few m. Be generous.
    const interior = r.shifts.slice(5, -5);
    expect(median(interior)).toBeLessThan(5);
  });

  it("flags shot-noise spikes and roughly matches the configured rate", () => {
    // 2 % rate, 100 m magnitude over 200 ticks → expect ~4 outliers ± slack.
    const fixes = captureSimulatorFixes(200, {
      kind: "shot",
      rate: 0.02,
      magnitudeM: 100,
    });
    const r = smoothTrack(fixes);
    expect(r.outliers.length).toBeGreaterThanOrEqual(2);
    expect(r.outliers.length).toBeLessThanOrEqual(8);
    // Each flagged index should sit far from its neighbours pre-smoothing.
    for (const idx of r.outliers) {
      expect(r.shifts[idx]).toBeGreaterThan(r.outlierThresholdM);
    }
  });

  it("dampens noisy bursts without flagging individual fixes", () => {
    // 5 m σ burst noise: plus baseline jitter (unseeded Math.random in the
    // simulator) typically peaks under the 20 m outlier floor, so any
    // flagged samples would indicate over-aggressive rejection.
    const fixes = captureSimulatorFixes(120, {
      kind: "noisy-burst",
      period: 30,
      burstLen: 10,
      noiseM: 5,
    });
    const r = smoothTrack(fixes);
    expect(r.outliers).toEqual([]);
    // Smoother should reduce the in-burst shift well below the noise σ.
    expect(median(r.shifts)).toBeLessThan(10);
  });

  it("handles dropouts (suppressed fixes) without producing NaN", () => {
    const fixes = captureSimulatorFixes(150, {
      kind: "dropout",
      rate: 0.2,
    });
    expect(fixes.length).toBeGreaterThan(50);
    expect(fixes.length).toBeLessThan(150);
    const r = smoothTrack(fixes);
    expect(r.smoothed.every((p) => Number.isFinite(p.lat))).toBe(true);
    expect(r.smoothed.every((p) => Number.isFinite(p.lon))).toBe(true);
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
