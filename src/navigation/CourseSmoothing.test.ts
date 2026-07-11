import { describe, expect, it, vi } from "vitest";
import {
  CourseSmoothing,
  circularDistanceDeg,
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
  it("holds ~3 samples at fast rates but clamps at the cap", () => {
    expect(einkBufferWindowMs(2000)).toBe(6_000);
    expect(einkBufferWindowMs(4000)).toBe(EINK_BUFFER_WINDOW_MAX_MS);
    // Slow tier (10 s) must clamp — an uncapped window lagged by ~half
    // its width and made the course line feel sluggish through turns
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
  it("circularDistanceDeg is the short-arc magnitude", () => {
    expect(circularDistanceDeg(350, 10)).toBeCloseTo(20, 1);
    expect(circularDistanceDeg(10, 190)).toBeCloseTo(180, 1);
    expect(circularDistanceDeg(90, 90)).toBe(0);
  });
});

describe("CourseSmoothing max-error guard", () => {
  it("snaps and warns when smoothed COG falls past the guard", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cs = new CourseSmoothing();
    cs.addSample(10, 5, 0, 0, 1000);
    cs.smooth(1000); // initialise at 10
    cs.smooth(1016); // tiny frame, still ~10
    // Target jumps to a near-reversal (~190) while smoothed is stuck at 10
    // (e.g. a render stall froze it); a small-dt frame would normally ease.
    cs.addSample(190, 5, 0.1, 0.1, 3000);
    cs.addSample(190, 5, 0.1, 0.1, 5000);
    const cog = cogOf(cs.smooth(1032)); // 16 ms frame, but ~180° error → snap
    expect(circularDistanceDeg(cog, 190)).toBeLessThan(1);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("eases (does not snap) for an in-range course change", () => {
    const cs = new CourseSmoothing();
    cs.addSample(0, 5, 0, 0, 1000);
    cs.smooth(1000); // initialise at 0
    cs.addSample(80, 5, 0.1, 0.1, 3000);
    cs.addSample(80, 5, 0.1, 0.1, 5000); // target → 80 (error < 120° guard)
    const cog = cogOf(cs.smooth(1100)); // dt 0.1 → partial ease, not a snap
    expect(cog).toBeGreaterThan(0);
    expect(cog).toBeLessThan(80);
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

/**
 * Drive a smoother through a COG trajectory: fixes at `intervalMs`, render
 * frames at ~60 fps between them. `cogAt(tMs)` gives the true course at each
 * fix time. Returns the smoothed COG timeline sampled per frame.
 */
function runTrajectory(
  cs: CourseSmoothing,
  cogAt: (tMs: number) => number,
  durationMs: number,
  intervalMs: number,
): { t: number; cog: number }[] {
  const out: { t: number; cog: number }[] = [];
  let nextFix = 0;
  for (let t = 0; t <= durationMs; t += 16) {
    if (t >= nextFix) {
      cs.addSample(cogAt(nextFix), 6, 42, -71, nextFix);
      nextFix += intervalMs;
    }
    const r = cs.smooth(t);
    if (r) out.push({ t, cog: r.cog });
  }
  return out;
}

/** First time (ms) after `fromMs` the smoothed COG stays within `deg` of `target`. */
function settleTime(
  timeline: { t: number; cog: number }[],
  target: number,
  deg: number,
  fromMs: number,
): number {
  for (let i = 0; i < timeline.length; i++) {
    const p = timeline[i];
    if (p.t < fromMs) continue;
    if (circularDistanceDeg(p.cog, target) <= deg) {
      // require it to STAY converged (no overshoot back out)
      if (
        timeline
          .slice(i)
          .every((q) => circularDistanceDeg(q.cog, target) <= deg + 2)
      ) {
        return p.t;
      }
    }
  }
  return Number.POSITIVE_INFINITY;
}

describe("CourseSmoothing turn commit", () => {
  // The measured 2026-07 sim scenario: 104° instant tack, 2 s fixes. The old
  // buffer-mean staircase took ~10 s (and with the quality feedback, longer).
  it("converges an instant 104° tack within ~5 s at 2 s fixes", () => {
    const cs = new CourseSmoothing();
    cs.setQuality(0.35); // the measured mid-tack quality score (2026-07 sim capture)
    const tackAt = 20_000;
    const cogAt = (t: number) => (t < tackAt ? 137 : 33);
    const tl = runTrajectory(cs, cogAt, 40_000, 2_000);
    const settled = settleTime(tl, 33, 5, tackAt);
    expect(settled - tackAt).toBeLessThan(5_500);
  });

  it("behaves the same at 1 Hz fixes (ΔT-relative, not sample-count)", () => {
    const cs = new CourseSmoothing();
    cs.setQuality(0.35);
    const tackAt = 20_000;
    const cogAt = (t: number) => (t < tackAt ? 137 : 33);
    const tl = runTrajectory(cs, cogAt, 40_000, 1_000);
    const settled = settleTime(tl, 33, 5, tackAt);
    expect(settled - tackAt).toBeLessThan(5_500);
  });

  it("tracks an extended 90° rounding (10 s at 9°/s) with bounded lag", () => {
    const cs = new CourseSmoothing();
    cs.setQuality(0.35);
    const start = 20_000;
    const cogAt = (t: number) => {
      if (t < start) return 90;
      if (t > start + 10_000) return 180;
      return 90 + ((t - start) / 10_000) * 90;
    };
    const tl = runTrajectory(cs, cogAt, 45_000, 1_000);
    // Settles on the new course within ~4 s of turn-stop
    const settled = settleTime(tl, 180, 5, start + 10_000);
    expect(settled - (start + 10_000)).toBeLessThan(4_000);
    // Once the turn commits, mid-turn lag stays bounded (old-course samples
    // don't drag the mean): from 5 s into the turn, error < 30°.
    for (const p of tl) {
      if (p.t >= start + 5_000 && p.t <= start + 10_000) {
        expect(circularDistanceDeg(p.cog, cogAt(p.t))).toBeLessThan(30);
      }
    }
  });

  it("a single shot glitch does not commit a turn", () => {
    const cs = new CourseSmoothing();
    // steady course with one fix 90° off
    const cogAt = (t: number) => (t === 10_000 ? 180 : 90);
    const tl = runTrajectory(cs, cogAt, 25_000, 1_000);
    for (const p of tl) {
      // smoothed course never strays far toward the glitch
      expect(circularDistanceDeg(p.cog, 90)).toBeLessThan(35);
    }
    expect(cs.isTurning()).toBe(false);
  });

  it("overrides bad-quality smoothing during a committed turn", () => {
    const cs = new CourseSmoothing();
    cs.setQuality(1); // 25 s window, tau 4 s — the heavy-smoothing regime
    const tackAt = 30_000;
    const cogAt = (t: number) => (t < tackAt ? 137 : 33);
    const tl = runTrajectory(cs, cogAt, 60_000, 2_000);
    const settled = settleTime(tl, 33, 5, tackAt);
    // Without the override this takes tens of seconds; with it, ~5 s.
    expect(settled - tackAt).toBeLessThan(6_500);
  });
});
