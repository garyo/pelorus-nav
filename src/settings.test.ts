import { describe, expect, it, vi } from "vitest";
import {
  convertDepth,
  depthConversionFactor,
  depthUnitLabel,
  formatDepth,
} from "./settings";

describe("settings migration", () => {
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
    expect(getSettings().settingsVersion).toBe(2);
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
    expect(JSON.parse(savedJson).settingsVersion).toBe(2);
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("doesn't re-persist on a load that needs no migration", async () => {
    const stored = { settingsVersion: 2, streetUnderlay: "osm" };
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
    const stored = '{"settingsVersion":2,"safetyDepth":1e400}';
    vi.stubGlobal("localStorage", {
      getItem: () => stored,
      setItem: () => {},
    });
    vi.resetModules();
    const { getSettings } = await import("./settings");
    expect(getSettings().safetyDepth).toBe(6.1);
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
    const stored = { settingsVersion: 2, shallowDepth: null };
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify(stored),
      setItem: () => {},
    });
    vi.resetModules();
    const { getSettings } = await import("./settings");
    expect(getSettings().shallowDepth).toBe(1.83);
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

  it("keeps a fully valid load unchanged", async () => {
    const stored = {
      settingsVersion: 2,
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
