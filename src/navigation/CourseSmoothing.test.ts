import { describe, expect, it } from "vitest";
import {
  CourseSmoothing,
  circularInterpolate,
  circularMeanDeg,
  EINK_BUFFER_WINDOW_MAX_MS,
  einkBufferWindowMs,
  type SmoothedCourse,
} from "./CourseSmoothing";

/** Assert smooth() produced a course and return its COG. */
function cogOf(r: SmoothedCourse | null): number {
  if (!r) throw new Error("expected a smoothed course");
  return r.cog;
}

describe("einkBufferWindowMs", () => {
  it("holds ~5 samples at fast rates but clamps at the cap", () => {
    expect(einkBufferWindowMs(2000)).toBe(10_000);
    expect(einkBufferWindowMs(5000)).toBe(EINK_BUFFER_WINDOW_MAX_MS);
    // Slow tier (10 s) used to produce a 50 s window — must clamp
    expect(einkBufferWindowMs(10_000)).toBe(EINK_BUFFER_WINDOW_MAX_MS);
  });
});

describe("circular helpers", () => {
  it("circularMeanDeg averages across the 0/360 wrap", () => {
    expect(circularMeanDeg([350, 10])).toBeCloseTo(0, 1);
  });
  it("circularInterpolate takes the short arc", () => {
    expect(circularInterpolate(350, 10, 0.5)).toBeCloseTo(0, 1);
  });
});

describe("CourseSmoothing resume behaviour", () => {
  it("slews gradually for normal frame-rate updates", () => {
    const cs = new CourseSmoothing();
    cs.addSample(0, 5, 0, 0, 1000);
    cs.smooth(1000); // initialise at 0
    cs.addSample(90, 5, 0, 0, 2000); // target → mean(0,90)=45
    const cog = cogOf(cs.smooth(1016)); // 16 ms frame → tiny slew, not a snap
    expect(cog).toBeGreaterThan(0);
    expect(cog).toBeLessThan(45);
  });

  it("snaps to the recovered course after a render gap (no slow slew)", () => {
    const cs = new CourseSmoothing();
    cs.addSample(10, 5, 0, 0, 1000);
    cs.smooth(1000); // initialise at 10
    // Recovery drain: a burst of passive points 30 s apart on a new heading.
    cs.addSample(200, 5, 0.1, 0.1, 299_970);
    cs.addSample(201, 5, 0.1, 0.1, 300_000);
    // huge dt → snap to recovered ~200, not slew from 10
    expect(cogOf(cs.smooth(300_000))).toBeCloseTo(200.5, 0);
  });

  it("still snaps when the drain lands a frame after the gap is detected", () => {
    const cs = new CourseSmoothing();
    cs.addSample(10, 5, 0, 0, 1000);
    cs.smooth(1000); // initialise at 10
    // Resume frame fires before the async drain populates the buffer.
    expect(cogOf(cs.smooth(300_000))).toBeCloseTo(10, 0); // nothing fresh → stale
    // Drain lands: pendingSnap keeps snapping as samples arrive.
    cs.addSample(200, 5, 0.1, 0.1, 299_970);
    cs.addSample(201, 5, 0.1, 0.1, 300_000);
    // normal frame → snapped to recovered course
    expect(cogOf(cs.smooth(300_016))).toBeCloseTo(200.5, 0);
    // Subsequent live samples resume normal smoothing (slew, not snap).
    cs.addSample(210, 5, 0.1, 0.1, 301_000);
    const r3 = cogOf(cs.smooth(301_016));
    expect(r3).toBeGreaterThan(200.5);
    expect(r3).toBeLessThan(204);
  });
});
