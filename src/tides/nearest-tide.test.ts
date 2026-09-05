import { describe, expect, it } from "vitest";
import miniBundle from "./__fixtures__/mini-bundle.json";
import { buildIndex } from "./bundle";
import { chooseNearestTide, matchingEvent } from "./nearest-tide";
import type { TideEvent } from "./predictor";
import type { TideSubStation, TidesBundle } from "./schema";

const bundle = miniBundle as unknown as TidesBundle;
const hull = bundle.tideSub[0] as TideSubStation;
/** Hull's twin, 45 minutes later on both high and low. */
const farCove: TideSubStation = {
  ...hull,
  id: "far-cove",
  name: "Far Cove",
  lat: 42.31,
  lng: -70.93,
  tHigh: 45,
  tLow: 45,
};
const at = new Date("2026-06-05T10:00:00Z");
/** Just off Boston's tide gauge. */
const boston = { lat: 42.354, lon: -71.05 };

describe("matchingEvent", () => {
  const ev = (type: "high" | "low", hours: number): TideEvent => ({
    type,
    time: new Date(at.getTime() + hours * 3_600_000),
    heightMeters: 1,
  });

  it("picks the same-type event closest in time", () => {
    const events = [
      ev("low", -6),
      ev("high", 0.2),
      ev("low", 6),
      ev("high", 12),
    ];
    expect(matchingEvent(events, ev("low", 5))).toBe(events[2]);
    expect(matchingEvent(events, ev("high", 11))).toBe(events[3]);
  });

  it("is null when no event of that type exists", () => {
    expect(matchingEvent([ev("low", 1)], ev("high", 1))).toBeNull();
  });
});

describe("chooseNearestTide", () => {
  it("suppresses a nearby station whose next event agrees within ten minutes", () => {
    const index = buildIndex(bundle);
    const result = chooseNearestTide(index, boston.lat, boston.lon, at);
    expect(result?.primary.station.name).toBe("BOSTON");
    expect(result?.primary.distanceNM).toBeLessThan(0.1);
    expect(result?.primary.next.time.getTime()).toBeGreaterThanOrEqual(
      at.getTime(),
    );
    // Hull is +5/+7 min on Boston — the same answer, so not offered.
    expect(result?.alternatives).toEqual([]);
  });

  it("offers a nearby station that disagrees by more than ten minutes", () => {
    const index = buildIndex({ ...bundle, tideSub: [hull, farCove] });
    const result = chooseNearestTide(index, boston.lat, boston.lon, at);
    expect(result?.alternatives.map((c) => c.station.name)).toEqual([
      "Far Cove",
    ]);
    const alt = result?.alternatives[0];
    expect(alt?.distanceNM).toBeGreaterThan(5);
    expect(alt?.next.type).toBeDefined();
  });

  it("still agrees when the primary's next event is minutes away and the other station's just passed", () => {
    // Pick an instant just before a Boston event so Hull's matching event
    // (+5 min) is still ahead while an earlier-shifted twin's has passed.
    const index0 = buildIndex(bundle);
    const first = chooseNearestTide(index0, boston.lat, boston.lon, at);
    const eventTime = first?.primary.next.time.getTime() ?? 0;
    const early: TideSubStation = { ...farCove, tHigh: -8, tLow: -8 };
    const index = buildIndex({ ...bundle, tideSub: [hull, early] });
    const result = chooseNearestTide(
      index,
      boston.lat,
      boston.lon,
      new Date(eventTime - 3 * 60_000),
    );
    expect(result?.primary.station.name).toBe("BOSTON");
    // Its low/high already passed 5 min ago, but it is the same event: agrees.
    expect(result?.alternatives).toEqual([]);
  });

  it("returns only the primary when it is the only station in range", () => {
    const index = buildIndex(bundle);
    const result = chooseNearestTide(index, boston.lat, boston.lon, at, {
      maxNM: 2,
    });
    expect(result?.primary.station.name).toBe("BOSTON");
    expect(result?.alternatives).toEqual([]);
  });

  it("is null far from any station", () => {
    expect(chooseNearestTide(buildIndex(bundle), 30, -80, at)).toBeNull();
  });

  it("skips a subordinate whose reference is missing rather than failing", () => {
    const orphan: TideSubStation = { ...hull, id: "orphan", refId: "nope" };
    const index = buildIndex({ ...bundle, tideSub: [orphan] });
    const result = chooseNearestTide(index, hull.lat, hull.lng, at);
    expect(result?.primary.station.name).toBe("BOSTON");
  });
});
