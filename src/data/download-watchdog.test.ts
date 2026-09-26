import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STALL_ERROR_NAME,
  STALL_TIMEOUT_MS,
  stallError,
  stallWatchdog,
} from "./download-watchdog";

describe("stallWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once the timeout passes with no activity", () => {
    const onStall = vi.fn();
    stallWatchdog(1000, onStall);
    vi.advanceTimersByTime(999);
    expect(onStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it("restarts the countdown on every kick", () => {
    const onStall = vi.fn();
    const watchdog = stallWatchdog(1000, onStall);
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(900);
      watchdog.kick();
    }
    expect(onStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it("never fires after stop", () => {
    const onStall = vi.fn();
    const watchdog = stallWatchdog(1000, onStall);
    watchdog.stop();
    vi.advanceTimersByTime(10_000);
    expect(onStall).not.toHaveBeenCalled();
  });
});

describe("stallError", () => {
  it("names the stall and how long nothing arrived", () => {
    const err = stallError();
    expect(err.name).toBe(STALL_ERROR_NAME);
    expect(err.message).toBe(
      `download stalled — no data for ${STALL_TIMEOUT_MS / 1000} s`,
    );
  });
});
