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
  const flyTo = vi.fn();
  const fire = vi.fn();
  const setLayerGroupEnabled = vi.fn();
  let panelAvailable = true;
  const host = {
    nav: { lastFix: () => fix },
    map: { raw: { getCenter: () => centre, getZoom: () => 9, flyTo, fire } },
    settings: { get: () => ({ depthUnit: "feet" }), setLayerGroupEnabled },
    ui: {
      showInfo: (infos: FeatureInfo[]) => {
        if (!panelAvailable) return false;
        shown.push(infos);
        return true;
      },
      setStatus,
    },
  } as unknown as PluginHost;
  return {
    host,
    shown,
    setStatus,
    flyTo,
    fire,
    setLayerGroupEnabled,
    blockPanel: () => {
      panelAvailable = false;
    },
  };
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
    expect(card.actions?.map((a) => a.label)).toEqual(["Show on chart"]);
  });

  it("'Show on chart' turns the tides layer on, flies to the station and releases follow mode", async () => {
    const { host, shown, flyTo, fire, setLayerGroupEnabled } = fakeHost({
      lat: 42.354,
      lon: -71.05,
      stale: false,
    });
    await createNearestTideAction(host, deps())();
    shown[0][0].actions?.[0].run();
    expect(setLayerGroupEnabled).toHaveBeenCalledWith("tidesCurrents", true);
    expect(fire).toHaveBeenCalledWith("pelorus:navigate");
    expect(flyTo).toHaveBeenCalledWith({
      center: [-71.05028, 42.35389],
      zoom: 12,
    });
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
      "Show on chart",
      expect.stringMatching(/^Far Cove · \d+\.\d+ nm · /),
    ]);
    card.actions?.[1].run();
    expect(shown[1][0].name).toBe("Far Cove");
    // …whose card offers the way back.
    expect(shown[1][0].actions?.[1].label).toMatch(/^BOSTON · /);
  });

  it("says so when another mode holds the info panel", async () => {
    const h = fakeHost({ lat: 42.354, lon: -71.05, stale: false });
    h.blockPanel();
    await createNearestTideAction(h.host, deps())();
    expect(h.shown).toEqual([]);
    expect(h.setStatus).toHaveBeenCalledWith("Finish editing to see tides");
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
