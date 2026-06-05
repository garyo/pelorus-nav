import { describe, expect, it } from "vitest";
import act0926Pred from "./__fixtures__/act0926-noaa-pred.json";
import bos1111Pred from "./__fixtures__/bos1111-noaa-pred.json";
import miniBundle from "./__fixtures__/mini-bundle.json";
import { buildIndex } from "./bundle";
import { CMS_PER_KNOT, type CurrentEvent, currentState } from "./currents";
import type { TidesBundle } from "./schema";

const index = buildIndex(miniBundle as TidesBundle);
const bos1111 = index.bundle.currentRef.find(
  (s) => s.id === "BOS1111" && s.disp,
);
const act0926 = index.bundle.currentSub.find((s) => s.id === "ACT0926");
if (!bos1111 || !act0926) throw new Error("fixture stations missing");

const gmt = (t: string): Date => new Date(`${t.replace(" ", "T")}Z`);

interface NoaaCP {
  current_predictions: {
    cp: {
      Type: "slack" | "flood" | "ebb";
      Time: string;
      Velocity_Major: number;
    }[];
  };
}

const START = new Date("2026-06-05T00:00:00Z");

const NOAA_TYPE: Record<CurrentEvent["type"], "flood" | "ebb" | "slack"> = {
  maxFlood: "flood",
  maxEbb: "ebb",
  slackBeforeEbb: "slack",
  slackBeforeFlood: "slack",
};

function compareEvents(
  published: NoaaCP,
  events: CurrentEvent[],
  maxPeakMinutes: number,
  maxSlackMinutes: number,
  maxKn: number,
): void {
  expect(events.length).toBeGreaterThanOrEqual(6);
  for (const e of events) {
    const noaaType = NOAA_TYPE[e.type];
    const match = published.current_predictions.cp
      .filter((p) => p.Type === noaaType)
      .map((p) => ({ time: gmt(p.Time), v: p.Velocity_Major }))
      .sort(
        (a, b) =>
          Math.abs(a.time.getTime() - e.time.getTime()) -
          Math.abs(b.time.getTime() - e.time.getTime()),
      )[0];
    expect(match).toBeDefined();
    const dtMin = Math.abs(e.time.getTime() - match.time.getTime()) / 60000;
    const limit = noaaType === "slack" ? maxSlackMinutes : maxPeakMinutes;
    expect(dtMin, `${e.type} at ${e.time.toISOString()}`).toBeLessThan(limit);
    expect(
      Math.abs(e.speedKn - Math.abs(match.v) / CMS_PER_KNOT),
      `${e.type} speed at ${e.time.toISOString()}`,
    ).toBeLessThan(maxKn);
  }
}

describe("currentState — reference station (BOS1111)", () => {
  const state = currentState(bos1111, index, START, 44);
  if (!state) throw new Error("no state");

  it("matches NOAA published max/slack events", () => {
    compareEvents(bos1111Pred as NoaaCP, state.events, 6, 20, 0.1);
  });

  it("is flooding toward meanFloodDir at published max flood", () => {
    // Published: flood 2026-06-05 03:22Z at 57.6 cm/s
    const s = currentState(bos1111, index, gmt("2026-06-05 03:22"));
    expect(s?.state).toBe("flood");
    expect(s?.dir).toBe(bos1111.floodDir);
    expect(s?.speedKn).toBeGreaterThan(0.9);
    expect(s?.speedKn).toBeLessThan(1.3);
  });

  it("is slack near published slack time", () => {
    // Published: slack 2026-06-05 06:53Z
    const s = currentState(bos1111, index, gmt("2026-06-05 06:55"));
    expect(s?.state).toBe("slack");
  });

  it("reports the cycle max near the published peak speed", () => {
    // Published peaks in window: flood 57.6 cm/s (~1.12 kt)
    const s = currentState(bos1111, index, gmt("2026-06-05 03:22"));
    expect(s?.cycleMaxKn).toBeGreaterThan(1.0);
    expect(s?.cycleMaxKn).toBeLessThan(1.35);
    // At max flood the instantaneous speed is ~the cycle max
    expect((s?.speedKn ?? 0) / (s?.cycleMaxKn ?? 1)).toBeGreaterThan(0.85);
  });

  it("is ebbing toward meanEbbDir at published max ebb", () => {
    // Published: ebb 2026-06-05 10:38Z at −55.8 cm/s
    const s = currentState(bos1111, index, gmt("2026-06-05 10:38"));
    expect(s?.state).toBe("ebb");
    expect(s?.dir).toBe(bos1111.ebbDir);
  });
});

describe("currentState — subordinate station (ACT0926)", () => {
  it("matches NOAA published events via reference + offsets", () => {
    const state = currentState(act0926, index, START, 44);
    if (!state) throw new Error("no state");
    compareEvents(act0926Pred as NoaaCP, state.events, 20, 30, 0.15);
  });

  it("interpolates a plausible mid-flood speed", () => {
    // Published: slack 00:40Z, flood max 04:47Z at 34.5 cm/s (≈0.67 kt)
    const s = currentState(act0926, index, gmt("2026-06-05 04:47"));
    expect(s?.state).toBe("flood");
    expect(s?.speedKn).toBeGreaterThan(0.4);
    expect(s?.speedKn).toBeLessThan(0.9);
    const accel = currentState(act0926, index, gmt("2026-06-05 02:40"));
    expect(accel?.speedKn).toBeLessThan(s?.speedKn ?? 0);
  });
});
