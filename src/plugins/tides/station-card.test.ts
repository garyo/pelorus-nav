import { describe, expect, it } from "vitest";
import miniBundle from "../../tides/__fixtures__/mini-bundle.json";
import { buildIndex } from "../../tides/bundle";
import { chooseNearestTide } from "../../tides/nearest-tide";
import type { TidesBundle } from "../../tides/schema";
import { buildTideStationInfo, formatStationChoice } from "./station-card";

const index = buildIndex(miniBundle as unknown as TidesBundle);
const boston = index.tideStations[0];
const hull = index.tideStations[1];
const now = new Date("2026-06-05T10:00:00Z");

describe("buildTideStationInfo", () => {
  it("lists now and the coming events for a reference station", () => {
    const info = buildTideStationInfo(boston, index, now, "feet");
    expect(info?.type).toBe("Tide Station");
    expect(info?.name).toBe("BOSTON");
    expect(info?.details[0].label).toMatch(/^Now/);
    expect(info?.details[0].value).toMatch(/ft \((rising|falling)\)$/);
    expect(info?.details[1].label).toMatch(/\(\+/); // "(+2h 10m)" until the first event
    expect(info?.details.length).toBeGreaterThan(4);
    expect(info?.actions).toBeUndefined();
  });

  it("marks a subordinate station as secondary", () => {
    expect(buildTideStationInfo(hull, index, now, "feet")?.type).toBe(
      "Tide Station (secondary)",
    );
  });

  it("puts the distance row first and carries the actions", () => {
    const actions = [{ label: "Hull · 6.4 nm", run: () => {} }];
    const info = buildTideStationInfo(boston, index, now, "meters", {
      distance: "0.02 nm from vessel",
      actions,
    });
    expect(info?.details[0]).toEqual({
      label: "Distance",
      value: "0.02 nm from vessel",
    });
    expect(info?.actions).toBe(actions);
  });

  it("is null for a subordinate whose reference is missing", () => {
    const orphan = { ...hull, refId: "nope" } as typeof hull;
    expect(buildTideStationInfo(orphan, index, now, "feet")).toBeNull();
  });
});

describe("formatStationChoice", () => {
  it("names the station, its distance and its next event", () => {
    const result = chooseNearestTide(index, 42.31, -70.93, now);
    const primary = result?.primary;
    if (!primary) throw new Error("no station");
    const text = formatStationChoice(primary, now, "feet");
    expect(text).toMatch(
      /^Hull · \d+\.\d+ nm · (High|Low) -?\d+\.\dft \d+:\d\d/,
    );
  });
});
