import { describe, expect, it } from "vitest";
import {
  describeBacklogRecovery,
  describeResumeGap,
  INTERRUPTION_NOTICE_MIN_MS,
  withVendorAdvice,
} from "./backlog-notice";

const MIN = 60_000;
const backlog = (startMs: number, endMs: number) => [
  { timestamp: startMs },
  { timestamp: endMs },
];

describe("describeBacklogRecovery", () => {
  it("says nothing for an empty backlog", () => {
    expect(describeBacklogRecovery([], 0, 0)).toBeNull();
  });

  it("says nothing when nothing was recorded and the app came right back", () => {
    const now = 100 * MIN;
    expect(describeBacklogRecovery(backlog(0, now - MIN), 0, now)).toBeNull();
  });

  it("reports the recovered span alone after a quick reload", () => {
    const now = 100 * MIN;
    const notice = describeBacklogRecovery(
      backlog(now - 30 * MIN, now - MIN),
      98,
      now,
    );
    expect(notice).toEqual({
      message: "Recovered 29m of track recorded while the app was closed.",
      interrupted: false,
    });
  });

  it("reports the interruption, and offers the remedy, after a long hole", () => {
    const now = 100 * MIN;
    const notice = describeBacklogRecovery(
      backlog(now - 40 * MIN, now - 10 * MIN),
      98,
      now,
    );
    expect(notice?.interrupted).toBe(true);
    expect(notice?.message).toBe(
      "Recovered 30m of track recorded while the app was closed. " +
        "Recording was interrupted for 10m — the system stopped the app.",
    );
  });

  it("reports an interruption even when every backlog point was a duplicate", () => {
    const now = 100 * MIN;
    const notice = describeBacklogRecovery(
      backlog(now - 40 * MIN, now - INTERRUPTION_NOTICE_MIN_MS),
      0,
      now,
    );
    expect(notice).toEqual({
      message: "Recording was interrupted for 2m — the system stopped the app.",
      interrupted: true,
    });
  });
});

describe("describeResumeGap", () => {
  it("says nothing for a gap below the notice threshold", () => {
    expect(describeResumeGap(INTERRUPTION_NOTICE_MIN_MS - 1, false)).toBeNull();
  });

  it("reports a gap that continued the same track", () => {
    expect(describeResumeGap(INTERRUPTION_NOTICE_MIN_MS, false)).toBe(
      "Track recording stopped for 2m while the app was closed.",
    );
  });

  it("adds that a new track was started when the gap split the track", () => {
    expect(describeResumeGap(32 * MIN, true)).toBe(
      "Track recording stopped for 32m while the app was closed. " +
        "A new track was started.",
    );
  });
});

describe("withVendorAdvice", () => {
  const message = "Track recording stopped for 32m while the app was closed.";

  it("adds the sleeping-apps advice on Samsung phones", () => {
    expect(withVendorAdvice(message, "samsung")).toBe(
      `${message} On Samsung phones, add Pelorus Nav to Never auto sleeping ` +
        "apps (Settings › Battery › Background usage limits).",
    );
  });

  it("leaves the message alone on other or unknown manufacturers", () => {
    expect(withVendorAdvice(message, "google")).toBe(message);
    expect(withVendorAdvice(message, null)).toBe(message);
  });
});
