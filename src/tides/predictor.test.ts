import { describe, expect, it } from "vitest";
import bostonHilo from "./__fixtures__/boston-noaa-hilo.json";
import bostonHourly from "./__fixtures__/boston-noaa-hourly.json";
import hullHilo from "./__fixtures__/hull-noaa-hilo.json";
import miniBundle from "./__fixtures__/mini-bundle.json";
import { buildIndex } from "./bundle";
import { tideNow, tideState } from "./predictor";
import type { TidesBundle } from "./schema";

const index = buildIndex(miniBundle as TidesBundle);
const boston = index.bundle.tideRef.find((s) => s.id === "8443970");
const hull = index.bundle.tideSub.find((s) => s.id === "8444351");
if (!boston || !hull) throw new Error("fixture stations missing");

/** NOAA "2026-06-05 01:00" (GMT) → Date */
const gmt = (t: string): Date => new Date(`${t.replace(" ", "T")}Z`);

interface NoaaHilo {
  predictions: { t: string; v: string; type: "H" | "L" }[];
}

const START = new Date("2026-06-05T00:00:00Z");

function compareEvents(
  published: NoaaHilo,
  events: { time: Date; type: "high" | "low"; heightMeters: number }[],
  maxMinutes: number,
  maxMeters: number,
): void {
  expect(events.length).toBeGreaterThanOrEqual(4);
  for (const e of events) {
    const match = published.predictions
      .filter((p) => (p.type === "H") === (e.type === "high"))
      .map((p) => ({ time: gmt(p.t), v: Number(p.v) }))
      .sort(
        (a, b) =>
          Math.abs(a.time.getTime() - e.time.getTime()) -
          Math.abs(b.time.getTime() - e.time.getTime()),
      )[0];
    expect(match).toBeDefined();
    const dtMin = Math.abs(e.time.getTime() - match.time.getTime()) / 60000;
    expect(dtMin, `${e.type} at ${e.time.toISOString()}`).toBeLessThan(
      maxMinutes,
    );
    expect(
      Math.abs(e.heightMeters - match.v),
      `${e.type} height at ${e.time.toISOString()}`,
    ).toBeLessThan(maxMeters);
  }
}

describe("tideState — reference station (Boston 8443970)", () => {
  const state = tideState(boston, index, START, 48);
  if (!state) throw new Error("no state");

  it("matches NOAA published high/low events", () => {
    compareEvents(bostonHilo as NoaaHilo, state.events, 5, 0.03);
  });

  it("matches NOAA published hourly heights", () => {
    const hourly = (bostonHourly as { predictions: { t: string; v: string }[] })
      .predictions;
    for (const sample of [hourly[0], hourly[6], hourly[12], hourly[18]]) {
      const s = tideState(boston, index, gmt(sample.t), 1);
      expect(s?.heightMeters).not.toBeNull();
      expect(
        Math.abs((s?.heightMeters ?? 0) - Number(sample.v)),
        `height at ${sample.t}`,
      ).toBeLessThan(0.05);
    }
  });

  it("reports rising before a high and falling after", () => {
    // Published: L 00:53Z, H 07:02Z, L 13:28Z on 2026-06-05
    const rising = tideState(boston, index, new Date("2026-06-05T04:00:00Z"));
    const falling = tideState(boston, index, new Date("2026-06-05T10:00:00Z"));
    expect(rising?.trend).toBe("rising");
    expect(falling?.trend).toBe("falling");
  });

  it("reports the cycle fraction near 1 at high and near 0 at low", () => {
    // Published: H 07:02Z (2.957 m), L 13:28Z (0.245 m) on 2026-06-05
    const atHigh = tideNow(boston, index, new Date("2026-06-05T07:02:00Z"));
    const atLow = tideNow(boston, index, new Date("2026-06-05T13:28:00Z"));
    const mid = tideNow(boston, index, new Date("2026-06-05T04:00:00Z"));
    expect(atHigh?.fraction).toBeGreaterThan(0.9);
    expect(atLow?.fraction).toBeLessThan(0.1);
    expect(mid?.fraction).toBeGreaterThan(0.2);
    expect(mid?.fraction).toBeLessThan(0.8);
  });
});

describe("tideState — subordinate station (Hull 8444351)", () => {
  it("matches NOAA published events via reference + offsets", () => {
    const state = tideState(hull, index, START, 48);
    if (!state) throw new Error("no state");
    expect(state.heightMeters).toBeNull();
    compareEvents(hullHilo as NoaaHilo, state.events, 8, 0.06);
  });

  it("derives trend from the next event", () => {
    // Hull published: L 01:00Z, H 07:07Z on 2026-06-05
    const rising = tideState(hull, index, new Date("2026-06-05T04:00:00Z"));
    expect(rising?.trend).toBe("rising");
  });

  it("only returns events inside the window", () => {
    const state = tideState(hull, index, START, 12);
    if (!state) throw new Error("no state");
    const endMs = START.getTime() + 12 * 3600_000;
    for (const e of state.events) {
      expect(e.time.getTime()).toBeGreaterThanOrEqual(START.getTime());
      expect(e.time.getTime()).toBeLessThanOrEqual(endMs);
    }
  });
});
