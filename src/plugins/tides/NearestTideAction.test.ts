import { describe, expect, it, vi } from "vitest";
import type { FeatureInfo } from "../../chart/feature-info";
import miniBundle from "../../tides/__fixtures__/mini-bundle.json";
import { buildIndex } from "../../tides/bundle";
import type { TideSubStation, TidesBundle } from "../../tides/schema";
import type { PluginFix, PluginHost } from "../types";
import { createNearestTideAction } from "./NearestTideAction";

const bundle = miniBundle as unknown as TidesBundle;
const hull = bundle.tideSub[0] as TideSubStation;
const farCove: TideSubStation = {
  ...hull,
  id: "far-cove",
  name: "Far Cove",
  lat: 42.31,
  lng: -70.93,
  tHigh: 45,
  tLow: 45,
};
const now = new Date("2026-06-05T10:00:00Z");

function fakeHost(
  fix: PluginFix | null,
  centre = { lat: 42.354, lng: -71.05 },
) {
  const shown: FeatureInfo[][] = [];
  const setStatus = vi.fn();
  const host = {
    nav: { lastFix: () => fix },
    map: { raw: { getCenter: () => centre } },
    settings: { get: () => ({ depthUnit: "feet" }) },
    ui: {
      showInfo: (infos: FeatureInfo[]) => shown.push(infos),
      setStatus,
    },
  } as unknown as PluginHost;
  return { host, shown, setStatus };
}

const deps = (b: TidesBundle = bundle) => ({
  loadIndex: async () => buildIndex(b),
  now: () => now,
});

describe("createNearestTideAction", () => {
  it("shows the station nearest the vessel, measured from the vessel", async () => {
    const { host, shown } = fakeHost({
      lat: 42.354,
      lon: -71.05,
      stale: false,
    });
    await createNearestTideAction(host, deps())();
    expect(shown).toHaveLength(1);
    const card = shown[0][0];
    expect(card.name).toBe("BOSTON");
    expect(card.details[0]).toEqual({
      label: "Distance",
      value: expect.stringMatching(/nm from vessel$/),
    });
    expect(card.actions).toBeUndefined();
  });

  it("falls back to the chart centre when the fix is stale", async () => {
    const { host, shown } = fakeHost(
      { lat: 0, lon: 0, stale: true },
      { lat: 42.3033, lng: -70.92 }, // Hull
    );
    await createNearestTideAction(host, deps())();
    expect(shown[0][0].name).toBe("Hull");
    expect(shown[0][0].details[0].value).toMatch(/from chart centre$/);
  });

  it("offers disagreeing stations as buttons that open their own card", async () => {
    const { host, shown } = fakeHost({
      lat: 42.354,
      lon: -71.05,
      stale: false,
    });
    await createNearestTideAction(
      host,
      deps({ ...bundle, tideSub: [hull, farCove] }),
    )();
    const card = shown[0][0];
    expect(card.actions?.map((a) => a.label)).toEqual([
      expect.stringMatching(/^Far Cove · \d+\.\d+ nm · /),
    ]);
    card.actions?.[0].run();
    expect(shown[1][0].name).toBe("Far Cove");
    // …whose card offers the way back.
    expect(shown[1][0].actions?.[0].label).toMatch(/^BOSTON · /);
  });

  it("reports when no station is in range or the data is unavailable", async () => {
    const far = fakeHost({ lat: 30, lon: -80, stale: false });
    await createNearestTideAction(far.host, deps())();
    expect(far.shown).toEqual([]);
    expect(far.setStatus).toHaveBeenCalledWith("No tide station within 25 nm");

    const broken = fakeHost(null);
    await createNearestTideAction(broken.host, {
      loadIndex: async () => {
        throw new Error("offline");
      },
      now: () => now,
    })();
    expect(broken.setStatus).toHaveBeenCalledWith("Tide data unavailable");
  });
});
