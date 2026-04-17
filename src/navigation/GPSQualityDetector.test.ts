import { describe, expect, it } from "vitest";
import { GPSQualityDetector } from "./GPSQualityDetector";
import type { NavigationData } from "./NavigationData";

function fix(
  lat: number,
  lon: number,
  t: number,
  accuracy: number | null = null,
): NavigationData {
  return {
    latitude: lat,
    longitude: lon,
    cog: null,
    sog: null,
    heading: null,
    accuracy,
    timestamp: t,
    source: "test",
  };
}

/** Feed a steady-path walker (2 kn east, 1s fixes, sub-metre jitter). */
function feedSteady(det: GPSQualityDetector, count: number): void {
  const baseLat = 42.35;
  const baseLon = -71.04;
  const cosLat = Math.cos((baseLat * Math.PI) / 180);
  const mPerSec = (2 * 1852) / 3600;
  const degPerSecLon = mPerSec / (111_111 * cosLat);
  for (let i = 0; i < count; i++) {
    // Deterministic sub-metre jitter — no Math.random to keep tests stable.
    const j = Math.sin(i * 1.7) * 0.0000002; // ~2cm
    det.onFix(fix(baseLat + j, baseLon + degPerSecLon * i + j, i * 1000));
  }
}

/** Feed a jittery walker: wide random-like jumps at 9s interval, reverses direction often. */
function feedJittery(det: GPSQualityDetector, count: number): void {
  const baseLat = 42.35;
  const baseLon = -71.04;
  for (let i = 0; i < count; i++) {
    // Deterministic pseudo-random offsets with ~15m scale and direction-flip pattern.
    const lat = baseLat + Math.sin(i * 2.3) * 0.00015;
    const lon = baseLon + Math.cos(i * 3.1) * 0.00015;
    det.onFix(fix(lat, lon, i * 9_000));
  }
}

describe("GPSQualityDetector", () => {
  it("scores 0 before enough samples", () => {
    const det = new GPSQualityDetector();
    det.onFix(fix(42.35, -71.04, 0));
    det.onFix(fix(42.35, -71.04, 1000));
    expect(det.getSignals().q).toBe(0);
  });

  it("reports q near 0 for a clean, steady path", () => {
    const det = new GPSQualityDetector();
    feedSteady(det, 20);
    expect(det.getSignals().q).toBeLessThan(0.15);
    expect(det.getSignals().reversalRate).toBeLessThan(0.1);
  });

  it("reports q near 1 for a jittery, slow-fix path", () => {
    const det = new GPSQualityDetector();
    feedJittery(det, 20);
    expect(det.getSignals().q).toBeGreaterThan(0.7);
  });

  it("flags high reported accuracy even on a quiet path", () => {
    const det = new GPSQualityDetector();
    const baseLat = 42.35;
    const baseLon = -71.04;
    for (let i = 0; i < 15; i++) {
      // stationary, but device reports 50m accuracy
      det.onFix(fix(baseLat, baseLon, i * 1000, 50));
    }
    // Accuracy signal should drive q up; other signals are quiet here.
    expect(det.getSignals().accuracyM).toBe(50);
    expect(det.getSignals().q).toBeGreaterThan(0.4);
  });

  it("low-passes q so a single brief anomaly doesn't spike", () => {
    const det = new GPSQualityDetector();
    feedSteady(det, 15);
    const quietQ = det.getSignals().q;
    // Inject one outlier fix.
    det.onFix(fix(42.36, -71.03, 15_000));
    const afterOneBad = det.getSignals().q;
    // The outlier creates a large step, but a single sample shouldn't
    // flip the low-passed output above the mid-point.
    expect(afterOneBad - quietQ).toBeLessThan(0.5);
  });

  it("reset() clears rolling state", () => {
    const det = new GPSQualityDetector();
    feedJittery(det, 15);
    expect(det.getSignals().q).toBeGreaterThan(0.5);
    det.reset();
    expect(det.getSignals().q).toBe(0);
    // After reset, a steady path should score low.
    feedSteady(det, 15);
    expect(det.getSignals().q).toBeLessThan(0.2);
  });

  it("uses median interval so a single gap doesn't mark GPS bad", () => {
    const det = new GPSQualityDetector();
    const baseLat = 42.35;
    const baseLon = -71.04;
    // Five good 1s fixes, one 60s gap, five more good 1s fixes.
    let t = 0;
    for (let i = 0; i < 5; i++)
      det.onFix(fix(baseLat, baseLon + i * 1e-5, t + i * 1000));
    t += 5 * 1000 + 60_000;
    for (let i = 0; i < 5; i++)
      det.onFix(fix(baseLat, baseLon + (5 + i) * 1e-5, t + i * 1000));
    // Median interval is 1s so interval signal stays quiet.
    expect(det.getSignals().intervalMs).toBeLessThan(2000);
  });
});
