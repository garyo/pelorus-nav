import { describe, expect, it } from "vitest";
import { fakeAudioContext } from "../utils/fake-audio-context";
import { ARRIVAL_NOTES, PASS_NOTES, scheduleChime } from "./waypoint-chime";

describe("scheduleChime", () => {
  it("plays the pass notes back to back from the context's current time", () => {
    const { ctx, started } = fakeAudioContext(2);
    scheduleChime(ctx, false);
    expect(started.map((s) => s.freq)).toEqual(PASS_NOTES.map((n) => n[0]));
    expect(started[0].at).toBe(2);
    expect(started[1].at).toBeCloseTo(2 + PASS_NOTES[0][1]);
    expect(started[1].until).toBeCloseTo(
      2 + PASS_NOTES[0][1] + PASS_NOTES[1][1],
    );
  });

  it("plays the longer arrival chime at the final waypoint", () => {
    const { ctx, started } = fakeAudioContext();
    scheduleChime(ctx, true);
    expect(started.map((s) => s.freq)).toEqual(ARRIVAL_NOTES.map((n) => n[0]));
    expect(started).toHaveLength(3);
  });
});
