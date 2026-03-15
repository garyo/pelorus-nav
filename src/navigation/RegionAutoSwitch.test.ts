import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NavigationData, NavigationDataCallback } from "./NavigationData";
import { RegionAutoSwitch } from "./RegionAutoSwitch";

// Mock localStorage for settings module
const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});

// Import settings AFTER localStorage is mocked
const { getSettings, updateSettings } = await import("../settings");

/** Minimal mock NavManager that lets us push GPS fixes. */
class MockNavManager {
  private listeners: NavigationDataCallback[] = [];
  subscribe(cb: NavigationDataCallback): void {
    this.listeners.push(cb);
  }
  pushFix(lat: number, lon: number): void {
    const data: NavigationData = {
      latitude: lat,
      longitude: lon,
      cog: null,
      sog: null,
      heading: null,
      accuracy: null,
      timestamp: Date.now(),
      source: "test",
    };
    for (const fn of this.listeners) fn(data);
  }
}

describe("RegionAutoSwitch", () => {
  beforeEach(() => {
    storage.clear();
    updateSettings({ activeRegion: "new-england" });
  });

  afterEach(() => {
    storage.clear();
  });

  it("switches after 3 consecutive fixes in a new region", () => {
    const mock = new MockNavManager();
    new RegionAutoSwitch(mock as never);

    expect(getSettings().activeRegion).toBe("new-england");

    // 3 fixes in USVI
    mock.pushFix(18.34, -64.93);
    mock.pushFix(18.34, -64.93);
    expect(getSettings().activeRegion).toBe("new-england"); // not yet
    mock.pushFix(18.34, -64.93);
    expect(getSettings().activeRegion).toBe("usvi"); // switched!
  });

  it("resets counter when returning to current region", () => {
    const mock = new MockNavManager();
    new RegionAutoSwitch(mock as never);

    // 2 fixes in USVI, then back to New England
    mock.pushFix(18.34, -64.93);
    mock.pushFix(18.34, -64.93);
    mock.pushFix(42.36, -71.06); // back to NE
    // Now 3 more in USVI — should need full 3 again
    mock.pushFix(18.34, -64.93);
    mock.pushFix(18.34, -64.93);
    expect(getSettings().activeRegion).toBe("new-england");
    mock.pushFix(18.34, -64.93);
    expect(getSettings().activeRegion).toBe("usvi");
  });

  it("does not switch for fixes outside all regions", () => {
    const mock = new MockNavManager();
    new RegionAutoSwitch(mock as never);

    mock.pushFix(0, 0);
    mock.pushFix(0, 0);
    mock.pushFix(0, 0);
    expect(getSettings().activeRegion).toBe("new-england");
  });
});
