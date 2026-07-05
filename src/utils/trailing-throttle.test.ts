import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrailingThrottle } from "./trailing-throttle";

/** A re-arming debounce, for contrast: clearTimeout + setTimeout every call. */
function createRearmingDebounce(fn: () => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    trigger(): void {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
  };
}

describe("createTrailingThrottle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires once after the window when called a single time", () => {
    const fn = vi.fn();
    const t = createTrailingThrottle(fn, 1000);
    t.trigger();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not starve under a steady stream faster than the window", () => {
    const fn = vi.fn();
    const t = createTrailingThrottle(fn, 1000);

    // Simulate moveend firing ~10 Hz (every 100ms) for 5 seconds, as in
    // follow/course-up mode underway.
    for (let i = 0; i < 50; i++) {
      t.trigger();
      vi.advanceTimersByTime(100);
    }

    // Bounded staleness: over a 5s stream with a 1s window, must fire
    // multiple times, not zero.
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(3);
    // Bounded rate: never more often than once per window.
    expect(fn.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("contrast: a re-arming debounce starves under the same stream", () => {
    const fn = vi.fn();
    const d = createRearmingDebounce(fn, 1000);

    for (let i = 0; i < 50; i++) {
      d.trigger();
      vi.advanceTimersByTime(100);
    }

    // The re-arming debounce never gets a 1000ms gap between calls while
    // events keep arriving every 100ms, so it never fires mid-stream.
    expect(fn).not.toHaveBeenCalled();

    // It only fires once the stream stops and the last-armed timer elapses.
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel() prevents a pending fire", () => {
    const fn = vi.fn();
    const t = createTrailingThrottle(fn, 1000);
    t.trigger();
    t.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});
