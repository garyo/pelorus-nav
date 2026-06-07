import { describe, expect, it, vi } from "vitest";
import {
  convertDepth,
  depthConversionFactor,
  depthUnitLabel,
  formatDepth,
} from "./settings";

describe("settings migration", () => {
  it("forces S-52 symbology and turns the street underlay on once (v2)", async () => {
    const stored = {
      symbologyScheme: "pelorus-standard",
      showOSMUnderlay: false,
    };
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify(stored),
      setItem: () => {},
    });
    vi.resetModules();
    const { getSettings } = await import("./settings");
    expect(getSettings().symbologyScheme).toBe("iho-s52");
    expect(getSettings().streetUnderlay).toBe("auto");
    expect(getSettings().settingsVersion).toBe(2);
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("migrates a v2 user's choice to turn the OSM underlay off", async () => {
    const stored = { settingsVersion: 2, showOSMUnderlay: false };
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify(stored),
      setItem: () => {},
    });
    vi.resetModules();
    const { getSettings } = await import("./settings");
    expect(getSettings().streetUnderlay).toBe("off");
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("keeps an explicit streetUnderlay mode over the legacy boolean", async () => {
    const stored = {
      settingsVersion: 2,
      showOSMUnderlay: false,
      streetUnderlay: "osm",
    };
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify(stored),
      setItem: () => {},
    });
    vi.resetModules();
    const { getSettings } = await import("./settings");
    expect(getSettings().streetUnderlay).toBe("osm");
    vi.unstubAllGlobals();
    vi.resetModules();
  });
});

describe("depth conversion", () => {
  it("meters factor is 1", () => {
    expect(depthConversionFactor("meters")).toBe(1);
  });

  it("converts meters to feet", () => {
    expect(convertDepth(1, "feet")).toBeCloseTo(3.28084, 4);
    expect(convertDepth(10, "feet")).toBeCloseTo(32.8084, 3);
  });

  it("converts meters to fathoms", () => {
    expect(convertDepth(1, "fathoms")).toBeCloseTo(0.546807, 4);
    expect(convertDepth(6, "fathoms")).toBeCloseTo(3.28084, 4);
  });

  it("formats meters with 1 decimal", () => {
    expect(formatDepth(4.2, "meters")).toBe("4.2m");
    expect(formatDepth(10, "meters")).toBe("10.0m");
  });

  it("formats feet with 0 decimals", () => {
    expect(formatDepth(3, "feet")).toBe("10ft");
  });

  it("formats fathoms with 1 decimal", () => {
    expect(formatDepth(10, "fathoms")).toBe("5.5fm");
  });

  it("returns correct unit labels", () => {
    expect(depthUnitLabel("meters")).toBe("m");
    expect(depthUnitLabel("feet")).toBe("ft");
    expect(depthUnitLabel("fathoms")).toBe("fm");
  });
});
