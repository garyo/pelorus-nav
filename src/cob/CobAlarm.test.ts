// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CobAlarm } from "./CobAlarm";

interface FakeAudioParam {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
}

function fakeParam(): FakeAudioParam {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
}

class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  started: number[] = [];
  resume = vi.fn(() => {
    this.state = "running";
    return Promise.resolve();
  });
  close = vi.fn(() => Promise.resolve());
  createOscillator() {
    const node = {
      type: "sine",
      frequency: fakeParam(),
      connect: vi.fn((target: unknown) => target),
      start: vi.fn((_at: number) => {
        this.started.push((node.frequency as FakeAudioParam).value);
      }),
      stop: vi.fn(),
    };
    return node;
  }
  createGain() {
    return { gain: fakeParam(), connect: vi.fn((t: unknown) => t) };
  }
}

describe("CobAlarm", () => {
  let fakeCtx: FakeAudioContext;
  let vibrate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fakeCtx = new FakeAudioContext();
    // Plain function constructor: `new AudioContext()` must yield fakeCtx
    // (a vi.fn arrow impl would be discarded by `new` semantics).
    vi.stubGlobal("AudioContext", function AudioContextStub() {
      return fakeCtx;
    });
    vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", {
      value: vibrate,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("schedules two tones per beat and vibrates", () => {
    const alarm = new CobAlarm();
    alarm.start(false);
    expect(fakeCtx.started).toEqual([880, 660]); // immediate first beat
    expect(vibrate).toHaveBeenCalledWith([400, 200, 400]);
    vi.advanceTimersByTime(1200);
    expect(fakeCtx.started).toEqual([880, 660, 880, 660]);
    alarm.dispose();
  });

  it("mute gates output but keeps the loop; unmute resumes instantly", () => {
    const alarm = new CobAlarm();
    alarm.start(true);
    vi.advanceTimersByTime(3 * 1200);
    expect(fakeCtx.started).toEqual([]);
    expect(vibrate).not.toHaveBeenCalled();
    expect(alarm.isRunning()).toBe(true);

    alarm.setMuted(false);
    vi.advanceTimersByTime(1200);
    expect(fakeCtx.started).toEqual([880, 660]);
    alarm.dispose();
  });

  it("stop halts the loop and cancels vibration", () => {
    const alarm = new CobAlarm();
    alarm.start(false);
    alarm.stop();
    expect(alarm.isRunning()).toBe(false);
    expect(vibrate).toHaveBeenLastCalledWith(0);
    const beats = fakeCtx.started.length;
    vi.advanceTimersByTime(5000);
    expect(fakeCtx.started.length).toBe(beats);
    alarm.dispose();
  });

  it("reports blocked when the context stays suspended, unblocks on retry", async () => {
    fakeCtx.state = "suspended";
    fakeCtx.resume = vi.fn(() => Promise.reject(new Error("no gesture")));
    const alarm = new CobAlarm();
    const blockedStates: boolean[] = [];
    alarm.onBlockedChange((b) => blockedStates.push(b));

    alarm.start(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(alarm.isBlocked()).toBe(true);
    expect(blockedStates).toContain(true);
    expect(fakeCtx.started).toEqual([]); // nothing scheduled while blocked

    // User gesture arrives: resume now succeeds.
    fakeCtx.resume = vi.fn(() => {
      fakeCtx.state = "running";
      return Promise.resolve();
    });
    alarm.retryUnlock();
    await vi.advanceTimersByTimeAsync(0);
    expect(alarm.isBlocked()).toBe(false);
    vi.advanceTimersByTime(1200);
    expect(fakeCtx.started).toEqual([880, 660]);
    alarm.dispose();
  });

  it("survives an environment without AudioContext or vibrate", () => {
    vi.stubGlobal(
      "AudioContext",
      vi.fn(() => {
        throw new Error("unavailable");
      }),
    );
    Object.defineProperty(navigator, "vibrate", {
      value: undefined,
      configurable: true,
    });
    const alarm = new CobAlarm();
    expect(() => {
      alarm.start(false);
      vi.advanceTimersByTime(2400);
      alarm.stop();
      alarm.dispose();
    }).not.toThrow();
  });
});
