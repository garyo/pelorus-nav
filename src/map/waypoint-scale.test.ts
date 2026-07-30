import { describe, expect, it, vi } from "vitest";

describe("waypoint-scale", () => {
  it("reports the current scale and notifies only on waypoint-scale changes", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
    });
    vi.resetModules();
    const { updateSettings } = await import("../settings");
    const { getWaypointScale, onWaypointScaleChange } = await import(
      "./waypoint-scale"
    );

    expect(getWaypointScale()).toBe(1);

    const seen: number[] = [];
    const unsubscribe = onWaypointScaleChange((s) => seen.push(s));

    updateSettings({ textScale: 1.5 });
    expect(seen).toEqual([]);

    updateSettings({ waypointScale: 0.7 });
    expect(getWaypointScale()).toBe(0.7);
    expect(seen).toEqual([0.7]);

    updateSettings({ speedUnit: "mph" });
    expect(seen).toEqual([0.7]);

    unsubscribe();
    updateSettings({ waypointScale: 1.2 });
    expect(seen).toEqual([0.7]);

    vi.unstubAllGlobals();
    vi.resetModules();
  });
});
