// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIdleDetector } from "./IdleDetector";

describe("createIdleDetector", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("becomes idle after the timeout and notifies once", () => {
    const det = createIdleDetector(1000);
    const changes: boolean[] = [];
    det.onChange((idle) => changes.push(idle));

    expect(det.isIdle()).toBe(false);
    vi.advanceTimersByTime(999);
    expect(det.isIdle()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(det.isIdle()).toBe(true);
    expect(changes).toEqual([true]);

    det.dispose();
  });

  it("user interaction clears idle and restarts the timeout", () => {
    const det = createIdleDetector(1000);
    vi.advanceTimersByTime(1000);
    expect(det.isIdle()).toBe(true);

    document.dispatchEvent(new Event("pointerdown"));
    expect(det.isIdle()).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(det.isIdle()).toBe(true);

    det.dispose();
  });

  it("reset() clears idle and restarts the timeout like an interaction", () => {
    const det = createIdleDetector(1000);
    const changes: boolean[] = [];
    det.onChange((idle) => changes.push(idle));

    vi.advanceTimersByTime(1000);
    expect(det.isIdle()).toBe(true);

    det.reset();
    expect(det.isIdle()).toBe(false);
    expect(changes).toEqual([true, false]);

    // Full timeout available again after reset.
    vi.advanceTimersByTime(999);
    expect(det.isIdle()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(det.isIdle()).toBe(true);

    det.dispose();
  });

  it("reset() while active just defers the timeout without notifying", () => {
    const det = createIdleDetector(1000);
    const changes: boolean[] = [];
    det.onChange((idle) => changes.push(idle));

    vi.advanceTimersByTime(900);
    det.reset();
    vi.advanceTimersByTime(900);
    expect(det.isIdle()).toBe(false);
    expect(changes).toEqual([]);

    det.dispose();
  });
});
