import { describe, expect, it } from "vitest";
import {
  closingSpeedKn,
  createSpeedAverager,
  LONG_WINDOW_MS,
  MAX_GAP_MS,
  MIN_SPAN_MS,
  SHORT_WINDOW_MS,
  type SpeedAverage,
} from "./speed-average";

/** Feed `sog` at `cog` every `stepMs` from `fromMs` to `toMs` inclusive. */
function feed(
  avg: ReturnType<typeof createSpeedAverager>,
  fromMs: number,
  toMs: number,
  sog: number | ((t: number) => number),
  cog: number | null = 90,
  stepMs = 1000,
): void {
  for (let t = fromMs; t <= toMs; t += stepMs) {
    avg.addSample(typeof sog === "function" ? sog(t) : sog, cog, t);
  }
}

describe("createSpeedAverager", () => {
  it("reports nothing until MIN_SPAN_MS of data exist", () => {
    const avg = createSpeedAverager();
    feed(avg, 0, MIN_SPAN_MS - 1000, 6);
    expect(avg.get()).toBeNull();
    avg.addSample(6, 90, MIN_SPAN_MS);
    expect(avg.get()?.speedKn).toBeCloseTo(6, 6);
    expect(avg.get()?.settling).toBe(false);
  });

  it("weights samples by time, not by count", () => {
    const avg = createSpeedAverager();
    // 4 kn at t=0 and t=10 s, 8 kn at t=40 s. Weights are the intervals
    // to the next sample (the last carries the previous one): 10, 30, 30 s,
    // so the mean is (40 + 120 + 240) / 70 = 40/7 kn. A per-sample mean
    // would say 16/3.
    avg.addSample(4, 90, 0);
    avg.addSample(4, 90, 10_000);
    avg.addSample(8, 90, 40_000);
    const a = avg.get() as SpeedAverage;
    expect(a.settling).toBe(false);
    expect(a.speedKn).toBeCloseTo(40 / 7, 6);
    expect(a.spanMs).toBe(40_000);
  });

  it("averages the velocity vector, so a tack sequence closes on the mean course", () => {
    const avg = createSpeedAverager();
    // 90 s on 045° then 90 s on 135°, both at 6 kn: average heading 090°,
    // average speed 6 kn, closing speed toward 090° = 6·cos 45°.
    feed(avg, 0, 90_000, 6, 45);
    feed(avg, 91_000, 180_000, 6, 135);
    const a = avg.get() as SpeedAverage;
    expect(a.settling).toBe(false);
    expect(a.speedKn).toBeCloseTo(6, 6);
    expect(closingSpeedKn(a, 90)).toBeCloseTo(6 * Math.SQRT1_2, 1);
    expect(closingSpeedKn(a, 270)).toBeCloseTo(-6 * Math.SQRT1_2, 1);
    expect(Math.abs(closingSpeedKn(a, 0))).toBeLessThan(0.2);
  });

  it("flags a speed change, follows the short window, then settles", () => {
    const avg = createSpeedAverager();
    feed(avg, 0, LONG_WINDOW_MS, 2);
    expect(avg.get()?.settling).toBe(false);
    // Engine on: 7 kn from now. Within the short window the reading jumps
    // to the new speed and is marked settling.
    const t0 = LONG_WINDOW_MS + 1000;
    feed(avg, t0, t0 + SHORT_WINDOW_MS, 7);
    const during = avg.get() as SpeedAverage;
    expect(during.settling).toBe(true);
    expect(during.speedKn).toBeCloseTo(7, 6);
    // Once the long window holds only the new speed it settles again.
    feed(avg, t0 + SHORT_WINDOW_MS + 1000, t0 + LONG_WINDOW_MS + 1000, 7);
    const after = avg.get() as SpeedAverage;
    expect(after.settling).toBe(false);
    expect(after.speedKn).toBeCloseTo(7, 6);
  });

  it("does not flag ordinary jitter around a steady speed", () => {
    const avg = createSpeedAverager();
    // ±0.3 kn triangle wave, the simulator's jitter amplitude.
    feed(avg, 0, LONG_WINDOW_MS, (t) => 6 + 0.3 * Math.sin(t / 3000));
    const a = avg.get() as SpeedAverage;
    expect(a.settling).toBe(false);
    expect(a.speedKn).toBeCloseTo(6, 1);
    expect(a.sdKn).toBeGreaterThan(0.1);
    expect(a.sdKn).toBeLessThan(0.3);
  });

  it("restarts after a gap longer than MAX_GAP_MS", () => {
    const avg = createSpeedAverager();
    feed(avg, 0, LONG_WINDOW_MS, 6);
    const resume = LONG_WINDOW_MS + MAX_GAP_MS + 1000;
    avg.addSample(3, 90, resume);
    expect(avg.get()).toBeNull();
    feed(avg, resume + 1000, resume + MIN_SPAN_MS, 3);
    expect(avg.get()?.speedKn).toBeCloseTo(3, 6);
  });

  it("keeps only the long window", () => {
    const avg = createSpeedAverager();
    feed(avg, 0, LONG_WINDOW_MS, 2);
    feed(avg, LONG_WINDOW_MS + 1000, 2 * LONG_WINDOW_MS + 1000, 5);
    const a = avg.get() as SpeedAverage;
    expect(a.speedKn).toBeCloseTo(5, 6);
    expect(a.spanMs).toBeLessThanOrEqual(LONG_WINDOW_MS);
  });

  it("skips null SOG and out-of-order timestamps, treats null COG as no direction", () => {
    const avg = createSpeedAverager();
    feed(avg, 0, MIN_SPAN_MS, 4, null);
    avg.addSample(null, 90, MIN_SPAN_MS + 1000);
    avg.addSample(99, 90, MIN_SPAN_MS - 5000);
    const a = avg.get() as SpeedAverage;
    expect(a.speedKn).toBeCloseTo(4, 6);
    expect(a.velocity.east).toBeCloseTo(0, 6);
    expect(a.velocity.north).toBeCloseTo(0, 6);
    expect(closingSpeedKn(a, 90)).toBeCloseTo(0, 6);
  });

  it("reset() forgets everything", () => {
    const avg = createSpeedAverager();
    feed(avg, 0, MIN_SPAN_MS, 4);
    avg.reset();
    expect(avg.get()).toBeNull();
  });
});
