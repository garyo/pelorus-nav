import { describe, expect, it } from "vitest";
import { fakeAudioContext } from "./fake-audio-context";
import { playTone } from "./tone";

describe("playTone", () => {
  it("schedules a square tone with attack and release ramps", () => {
    const { ctx, started, ramps } = fakeAudioContext();
    playTone(ctx, 880, 1, 0.4, 0.3);
    expect(started).toEqual([{ freq: 880, type: "square", at: 1, until: 1.4 }]);
    expect(ramps.map(([k, v, t]) => [k, v, Number(t.toFixed(6))])).toEqual([
      ["set", 0, 1],
      ["ramp", 0.3, 1.02],
      ["set", 0.3, 1.35],
      ["ramp", 0, 1.4],
    ]);
  });

  it("honours the oscillator type", () => {
    const { ctx, started } = fakeAudioContext();
    playTone(ctx, 440, 0, 0.1, 0.5, "sine");
    expect(started[0].type).toBe("sine");
  });
});
