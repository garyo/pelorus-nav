import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebounceMaxWait } from "./debounce-max-wait";

describe("createDebounceMaxWait", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires once, a quiet period after the last trigger", () => {
    const fn = vi.fn();
    const d = createDebounceMaxWait(fn, 1000, 5000);
    d.trigger();
    vi.advanceTimersByTime(600);
    d.trigger();
    vi.advanceTimersByTime(600);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("fires by the ceiling under a stream that never goes quiet", () => {
    const fn = vi.fn();
    const d = createDebounceMaxWait(fn, 1000, 5000);
    for (let t = 0; t < 12_000; t += 100) {
      d.trigger();
      vi.advanceTimersByTime(100);
    }
    // 12 s of continuous triggers → fired at 5 s and 10 s.
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("cancel drops a pending fire; flush runs it now", () => {
    const fn = vi.fn();
    const d = createDebounceMaxWait(fn, 1000, 5000);
    d.trigger();
    d.cancel();
    vi.advanceTimersByTime(6000);
    expect(fn).not.toHaveBeenCalled();

    d.trigger();
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(6000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
