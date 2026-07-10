import { describe, expect, it } from "vitest";
import { createStationaryTracker } from "./stationary";

/** Tracker with a controllable clock; feed fixes at 1 Hz like real GPS. */
function harness() {
  let t = 0;
  const tracker = createStationaryTracker(() => t);
  return {
    tracker,
    /** Advance n seconds, delivering one fix per second. */
    fixesFor(seconds: number, sogKt: number | null) {
      for (let i = 0; i < seconds; i++) {
        t += 1000;
        tracker.onFix(sogKt);
      }
    },
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("createStationaryTracker", () => {
  it("starts non-stationary and needs 30 s of sustained slow fixes", () => {
    const h = harness();
    expect(h.tracker.isStationary()).toBe(false);
    h.fixesFor(29, 0.1);
    expect(h.tracker.isStationary()).toBe(false);
    h.fixesFor(2, 0.1);
    expect(h.tracker.isStationary()).toBe(true);
  });

  it("a single fast fix exits immediately and restarts the clock", () => {
    const h = harness();
    h.fixesFor(31, 0.1);
    expect(h.tracker.isStationary()).toBe(true);
    h.fixesFor(1, 2.5); // gust / drift
    expect(h.tracker.isStationary()).toBe(false);
    h.fixesFor(29, 0.1);
    expect(h.tracker.isStationary()).toBe(false); // full 30 s again
    h.fixesFor(2, 0.1);
    expect(h.tracker.isStationary()).toBe(true);
  });

  it("unknown SOG counts as moving", () => {
    const h = harness();
    h.fixesFor(31, null);
    expect(h.tracker.isStationary()).toBe(false);
  });

  it("silence is not stillness — stale fixes drop the claim", () => {
    const h = harness();
    h.fixesFor(31, 0.1);
    expect(h.tracker.isStationary()).toBe(true);
    h.advance(6000); // GPS stops for 6 s
    expect(h.tracker.isStationary()).toBe(false);
  });
});
