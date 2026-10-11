import { describe, expect, it, vi } from "vitest";
import {
  ALLOWED_VALUES,
  chartDepthValue,
  convertDepth,
  depthConversionFactor,
  depthUnitLabel,
  formatChartDepth,
  formatChartHeight,
  formatDepth,
  type Settings,
} from "./settings";

describe("settings migration", () => {
  async function loadStored(stored: Record<string, unknown>) {
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify(stored),
      setItem: () => {},
    });
    vi.resetModules();
    const { getSettings } = await import("./settings");
    const settings = getSettings();
    vi.unstubAllGlobals();
    vi.resetModules();
    return settings;
  }

  it("moves v2's untouched depth defaults to NOAA's 5/11/17 ft (v3)", async () => {
    const s = await loadStored({
      settingsVersion: 2,
      shallowDepth: 1.83,
      safetyDepth: 6.1,
      deepDepth: 15.24,
    });
    expect(s.shallowDepth).toBe(5 * 0.3048);
    expect(s.safetyDepth).toBe(11 * 0.3048);
    expect(s.deepDepth).toBe(17 * 0.3048);
  });

  it("keeps chosen v2 feet depths on the same contour (v3)", async () => {
    const s = await loadStored({
      settingsVersion: 2,
      depthUnit: "feet",
      shallowDepth: 6 / 3.28084,
      safetyDepth: 12 / 3.28084,
      deepDepth: 30 / 3.28084,
    });
    expect(s.shallowDepth / 0.3048).toBeCloseTo(5, 9);
    expect(s.safetyDepth / 0.3048).toBeCloseTo(11, 9);
    expect(s.deepDepth / 0.3048).toBeCloseTo(29, 9);
  });

  it("leaves chosen metric depths and v3 settings alone", async () => {
    const metric = await loadStored({
      settingsVersion: 2,
      depthUnit: "meters",
      safetyDepth: 5,
    });
    expect(metric.safetyDepth).toBe(5);
    const v3 = await loadStored({ settingsVersion: 3, safetyDepth: 1.83 });
    expect(v3.safetyDepth).toBe(1.83);
  });

  it("forces S-52 symbology and defaults the street underlay on (v1, no prior preference)", async () => {
    const stored = {
      symbologyScheme: "pelorus-standard",
    };
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify(stored),
      setItem: () => {},
    });
    vi.resetModules();
    const { getSettings } = await import("./settings");
    expect(getSettings().symbologyScheme).toBe("iho-s52");
    expect(getSettings().streetUnderlay).toBe("auto");
    expect(getSettings().settingsVersion).toBe(3);
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("honors an explicit v1 showOSMUnderlay=false instead of forcing it on", async () => {
    // UI-13: the v1→v2 migration used to force showOSMUnderlay=true before
    // the streetUnderlay migration read it, discarding an explicit "off".
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
    expect(getSettings().streetUnderlay).toBe("off");
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("persists once after a v1→v2 migration so it doesn't re-run every startup", async () => {
    const stored = { symbologyScheme: "pelorus-standard" };
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify(stored),
      setItem,
    });
    vi.resetModules();
    await import("./settings");
    expect(setItem).toHaveBeenCalledTimes(1);
    const [, savedJson] = setItem.mock.calls[0] as [string, string];
    expect(JSON.parse(savedJson).settingsVersion).toBe(3);
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("doesn't re-persist on a load that needs no migration", async () => {
    const stored = { settingsVersion: 3, streetUnderlay: "osm" };
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify(stored),
      setItem,
    });
    vi.resetModules();
    await import("./settings");
    expect(setItem).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("carries a user's Signal K URL into signalkServer and persists once", async () => {
    const stored = {
      settingsVersion: 2,
      signalkUrl: "ws://192.168.1.50:3000/signalk/v1/stream?subscribe=none",
    };
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify(stored),
      setItem,
    });
    vi.resetModules();
    const { getSettings } = await import("./settings");
    expect(getSettings().signalkServer).toBe(stored.signalkUrl);
    expect("signalkUrl" in getSettings()).toBe(false);
    expect(setItem).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("blanks the untouched localhost Signal K default", async () => {
    const stored = {
      settingsVersion: 2,
      signalkUrl: "ws://localhost:3000/signalk/v1/stream?subscribe=none",
    };
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify(stored),
      setItem: () => {},
    });
    vi.resetModules();
    const { getSettings } = await import("./settings");
    expect(getSettings().signalkServer).toBe("");
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("coerces a legacy simplified-minimal symbology to iho-s52", async () => {
    const stored = {
      settingsVersion: 2,
      symbologyScheme: "simplified-minimal",
    };
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify(stored),
      setItem: () => {},
    });
    vi.resetModules();
    const { getSettings } = await import("./settings");
    expect(getSettings().symbologyScheme).toBe("iho-s52");
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

describe("settings save() resilience", () => {
  it("applies settings in memory even when localStorage.setItem throws", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    vi.resetModules();
    const { getSettings, updateSettings } = await import("./settings");
    expect(() => updateSettings({ depthUnit: "fathoms" })).not.toThrow();
    expect(getSettings().depthUnit).toBe("fathoms");
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("still notifies listeners when persistence fails", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    vi.resetModules();
    const { onSettingsChange, updateSettings } = await import("./settings");
    const listener = vi.fn();
    onSettingsChange(listener);
    updateSettings({ speedUnit: "mph" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].speedUnit).toBe("mph");
    vi.unstubAllGlobals();
    vi.resetModules();
  });
});

describe("settings load() validation", () => {
  it("falls back to the default on a wrong-type value", async () => {
    const stored = { settingsVersion: 2, textScale: "big" };
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify(stored),
      setItem: () => {},
    });
    vi.resetModules();
    const { getSettings } = await import("./settings");
    expect(getSettings().textScale).toBe(1);
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("falls back to the default on a non-finite number", async () => {
    // 1e400 parses to Infinity — a valid JSON number token, not a valid depth.
    const stored = '{"settingsVersion":3,"safetyDepth":1e400}';
    vi.stubGlobal("localStorage", {
      getItem: () => stored,
      setItem: () => {},
    });
    vi.resetModules();
    const { getSettings } = await import("./settings");
    expect(getSettings().safetyDepth).toBe(11 * 0.3048);
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("falls back to the default on an unknown enum string", async () => {
    const stored = { settingsVersion: 2, displayTheme: "ultraviolet" };
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify(stored),
      setItem: () => {},
    });
    vi.resetModules();
    const { getSettings } = await import("./settings");
    expect(getSettings().displayTheme).toBe("day");
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("falls back to the default on null", async () => {
    const stored = { settingsVersion: 3, shallowDepth: null };
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify(stored),
      setItem: () => {},
    });
    vi.resetModules();
    const { getSettings } = await import("./settings");
    expect(getSettings().shallowDepth).toBe(5 * 0.3048);
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("falls back to the default on a malformed instrumentCells tuple", async () => {
    const stored = { settingsVersion: 2, instrumentCells: "sog" };
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify(stored),
      setItem: () => {},
    });
    vi.resetModules();
    const { getSettings } = await import("./settings");
    expect(getSettings().instrumentCells).toEqual(["sog", "cog"]);
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("falls back to the default on malformed collapsedRouteFolders", async () => {
    const stored = { settingsVersion: 2, collapsedRouteFolders: [1, "USVI"] };
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify(stored),
      setItem: () => {},
    });
    vi.resetModules();
    const { getSettings } = await import("./settings");
    expect(getSettings().collapsedRouteFolders).toEqual([]);
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("keeps a valid collapsedRouteFolders array", async () => {
    const stored = { settingsVersion: 2, collapsedRouteFolders: ["USVI"] };
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify(stored),
      setItem: () => {},
    });
    vi.resetModules();
    const { getSettings } = await import("./settings");
    expect(getSettings().collapsedRouteFolders).toEqual(["USVI"]);
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("keeps a fully valid load unchanged", async () => {
    const stored = {
      settingsVersion: 3,
      textScale: 1.5,
      displayTheme: "night",
      shallowDepth: 2.5,
      detailLevel: 2,
      instrumentCells: ["dpt", "wind"],
    };
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify(stored),
      setItem: () => {},
    });
    vi.resetModules();
    const { getSettings } = await import("./settings");
    expect(getSettings().textScale).toBe(1.5);
    expect(getSettings().displayTheme).toBe("night");
    expect(getSettings().shallowDepth).toBe(2.5);
    expect(getSettings().detailLevel).toBe(2);
    expect(getSettings().instrumentCells).toEqual(["dpt", "wind"]);
    vi.unstubAllGlobals();
    vi.resetModules();
  });
});

describe("settings load() ALLOWED_VALUES round-trip", () => {
  async function loadWith(stored: Record<string, unknown>): Promise<Settings> {
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify(stored),
      setItem: () => {},
    });
    vi.resetModules();
    const { getSettings } = await import("./settings");
    const settings = getSettings();
    vi.unstubAllGlobals();
    vi.resetModules();
    return settings;
  }

  for (const key of Object.keys(ALLOWED_VALUES) as (keyof Settings)[]) {
    const values = ALLOWED_VALUES[key] ?? [];
    for (const value of values) {
      it(`accepts ${key}=${JSON.stringify(value)} (incl. mixed-type unions)`, async () => {
        const settings = await loadWith({ settingsVersion: 2, [key]: value });
        expect(settings[key]).toBe(value);
      });
    }
  }

  it("rejects an out-of-range courseLineDuration number and falls back to default", async () => {
    const settings = await loadWith({
      settingsVersion: 2,
      courseLineDuration: 7,
    });
    expect(settings.courseLineDuration).toBe("auto");
  });

  it("rejects an unrecognized courseLineDuration string and falls back to default", async () => {
    const settings = await loadWith({
      settingsVersion: 2,
      courseLineDuration: "fast",
    });
    expect(settings.courseLineDuration).toBe("auto");
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

  it("truncates charted depths to the shoaler whole foot", () => {
    // NOAA encodes feet charts truncated to 0.1 m: 37 ft → 11.2 m = 36.75 ft.
    expect(chartDepthValue(11.2, "feet")).toBe(36);
    expect(chartDepthValue(1.2, "feet")).toBe(3); // 3.94 ft
    expect(chartDepthValue(3.048, "feet")).toBe(10); // exactly 10 ft
    expect(chartDepthValue(0, "feet")).toBe(0);
  });

  it("truncates charted depths to tenths of a metre or fathom", () => {
    expect(chartDepthValue(2.3, "meters")).toBe(2.3); // 22.999… before epsilon
    expect(chartDepthValue(2.37, "meters")).toBe(2.3);
    expect(chartDepthValue(10, "fathoms")).toBe(5.4); // 5.468 fm
  });

  it("formats charted depths with unit suffix", () => {
    expect(formatChartDepth(1.2, "feet")).toBe("3ft");
    expect(formatChartDepth(10, "meters")).toBe("10.0m");
    expect(formatChartDepth(10, "fathoms")).toBe("5.4fm");
  });

  it("formats charted heights in feet for feet or fathoms, truncated", () => {
    expect(formatChartHeight(65.2, "feet")).toBe("213ft"); // 213.91 ft
    expect(formatChartHeight(65.2, "fathoms")).toBe("213ft");
    expect(formatChartHeight(65.27, "meters")).toBe("65.2m");
  });

  it("returns correct unit labels", () => {
    expect(depthUnitLabel("meters")).toBe("m");
    expect(depthUnitLabel("feet")).toBe("ft");
    expect(depthUnitLabel("fathoms")).toBe("fm");
  });
});
