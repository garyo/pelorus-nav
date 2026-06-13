import { afterEach, describe, expect, it, vi } from "vitest";
import {
  displayTime,
  getOffsetMs,
  MAX_OFFSET_MS,
  onChange,
  setOffsetMs,
} from "./displayTime";

afterEach(() => {
  setOffsetMs(0); // reset module state between tests
  vi.useRealTimers();
});

describe("displayTime store", () => {
  it("defaults to now (zero offset)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T12:00:00Z"));
    expect(getOffsetMs()).toBe(0);
    expect(displayTime().getTime()).toBe(Date.parse("2026-06-13T12:00:00Z"));
  });

  it("displayTime = now + offset, recomputed live", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T12:00:00Z"));
    setOffsetMs(3 * 3_600_000);
    expect(displayTime().getTime()).toBe(Date.parse("2026-06-13T15:00:00Z"));
    // Wall clock advances; the offset stays 3 h ahead.
    vi.setSystemTime(new Date("2026-06-13T13:00:00Z"));
    expect(displayTime().getTime()).toBe(Date.parse("2026-06-13T16:00:00Z"));
  });

  it("clamps to [0, MAX_OFFSET_MS]", () => {
    setOffsetMs(-5000);
    expect(getOffsetMs()).toBe(0);
    setOffsetMs(MAX_OFFSET_MS + 9_999_999);
    expect(getOffsetMs()).toBe(MAX_OFFSET_MS);
  });

  it("notifies listeners only on real change, and unsubscribe works", () => {
    const seen: number[] = [];
    const off = onChange((ms) => seen.push(ms));
    setOffsetMs(3_600_000);
    setOffsetMs(3_600_000); // no-op: same value
    expect(seen).toEqual([3_600_000]);
    off();
    setOffsetMs(7_200_000);
    expect(seen).toEqual([3_600_000]); // no further calls after unsubscribe
  });
});
