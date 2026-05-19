import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSettings, updateSettings } from "../settings";
import { formatFeatureInfo } from "./feature-info";

// Stub localStorage for updateSettings in test environment
if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      store: {} as Record<string, string>,
      getItem(key: string) {
        return this.store[key] ?? null;
      },
      setItem(key: string, val: string) {
        this.store[key] = val;
      },
      removeItem(key: string) {
        delete this.store[key];
      },
    },
  });
}

describe("formatFeatureInfo", () => {
  const savedUnit = getSettings().depthUnit;
  beforeAll(() => updateSettings({ depthUnit: "meters" }));
  afterAll(() => updateSettings({ depthUnit: savedUnit }));
  it("formats a lateral buoy with all attributes", () => {
    const info = formatFeatureInfo("BOYLAT", {
      OBJNAM: "Boston Approach #3",
      LABEL: "3",
      CATLAM: 1,
      BOYSHP: 2,
      COLOUR: "3",
    });
    expect(info.type).toBe("Lateral Buoy");
    expect(info.name).toBe("Boston Approach #3");
    expect(info.details).toContainEqual({ label: "Number", value: '"3"' });
    expect(info.details).toContainEqual({ label: "Category", value: "Port" });
    expect(info.details).toContainEqual({
      label: "Appearance",
      value: "Red Can",
    });
  });

  it("formats a buoy using OBJNAM when LABEL is missing", () => {
    const info = formatFeatureInfo("BOYLAT", {
      OBJNAM: "BH-5",
      CATLAM: 2,
    });
    expect(info.details).toContainEqual({ label: "Number", value: '"BH-5"' });
    expect(info.details).toContainEqual({
      label: "Category",
      value: "Starboard",
    });
  });

  it("formats a navigation light", () => {
    const info = formatFeatureInfo("LIGHTS", {
      LABEL: "Fl G 4s",
      HEIGHT: 12,
      VALNMR: 6,
      COLOUR: "green",
    });
    expect(info.type).toBe("Navigation Light");
    expect(info.details).toContainEqual({
      label: "Characteristic",
      value: "Fl G 4s",
    });
    expect(info.details).toContainEqual({ label: "Height", value: "12.0m" });
    expect(info.details).toContainEqual({
      label: "Nominal Range",
      value: "6 NM",
    });
  });

  it("formats a wreck", () => {
    const info = formatFeatureInfo("WRECKS", {
      CATWRK: 2,
      VALSOU: 3.5,
      WATLEV: 3,
    });
    expect(info.type).toBe("Wreck [Depth: 3.5m]");
    expect(info.details).toContainEqual({
      label: "Category",
      value: "Dangerous",
    });
    expect(info.details).toContainEqual({ label: "Depth", value: "3.5m" });
    expect(info.details).toContainEqual({
      label: "Water Level",
      value: "Always underwater",
    });
  });

  it("formats an obstruction", () => {
    const info = formatFeatureInfo("OBSTRN", {
      CATOBS: 6,
      VALSOU: 1.2,
    });
    expect(info.type).toBe("Obstruction [Depth: 1.2m]");
    expect(info.details).toContainEqual({
      label: "Category",
      value: "Foul area",
    });
    expect(info.details).toContainEqual({ label: "Depth", value: "1.2m" });
  });

  it("formats an underwater rock", () => {
    const info = formatFeatureInfo("UWTROC", {
      VALSOU: 0.5,
      WATLEV: 4,
    });
    expect(info.type).toBe("Underwater Rock [Depth: 0.5m]");
    expect(info.details).toContainEqual({ label: "Depth", value: "0.5m" });
    expect(info.details).toContainEqual({
      label: "Water Level",
      value: "Covers and uncovers",
    });
  });

  it("formats a depth area", () => {
    const info = formatFeatureInfo("DEPARE", {
      DRVAL1: 5.0,
      DRVAL2: 10.0,
    });
    expect(info.type).toBe("Depth Area [5.0m - 10.0m]");
    expect(info.details).toContainEqual({
      label: "Depth Range",
      value: "5.0m - 10.0m",
    });
  });

  it("formats a sounding", () => {
    const info = formatFeatureInfo("SOUNDG", { DEPTH: 4.2 });
    expect(info.type).toBe("Sounding");
    expect(info.details).toContainEqual({ label: "Depth", value: "4.2m" });
  });

  it("formats a restricted area", () => {
    const info = formatFeatureInfo("RESARE", {
      OBJNAM: "Wildlife Refuge",
      CATREA: 4,
    });
    expect(info.type).toBe("Restricted Area");
    expect(info.name).toBe("Wildlife Refuge");
    expect(info.details).toContainEqual({
      label: "Restriction",
      value: "Nature reserve",
    });
  });

  it("formats a lateral beacon", () => {
    const info = formatFeatureInfo("BCNLAT", {
      LABEL: "7",
      CATLAM: 1,
      COLOUR: "red",
    });
    expect(info.type).toBe("Lateral Beacon");
    expect(info.details).toContainEqual({ label: "Number", value: '"7"' });
    expect(info.details).toContainEqual({ label: "Category", value: "Port" });
  });

  it("falls back to raw properties for unknown layers", () => {
    const info = formatFeatureInfo("SOMETHINGNEW", {
      OBJNAM: "Test",
      FOO: "bar",
      RCID: 123,
      FIDN: 456,
    });
    expect(info.type).toBe("SOMETHINGNEW");
    expect(info.name).toBe("Test");
    // Should include FOO but filter out internal fields and OBJNAM (shown in title)
    expect(info.details).toContainEqual({ label: "FOO", value: "bar" });
    expect(info.details.find((d) => d.label === "OBJNAM")).toBeUndefined();
    expect(info.details.find((d) => d.label === "RCID")).toBeUndefined();
    expect(info.details.find((d) => d.label === "FIDN")).toBeUndefined();
  });

  it("handles missing optional properties gracefully", () => {
    const info = formatFeatureInfo("LIGHTS", {});
    expect(info.type).toBe("Navigation Light");
    expect(info.name).toBeUndefined();
    expect(info.details).toEqual([]);
  });

  it("formats land area with name only", () => {
    const info = formatFeatureInfo("LNDARE", {
      OBJNAM: "Castle Island",
    });
    expect(info.type).toBe("Land Area");
    expect(info.name).toBe("Castle Island");
  });
});

// --- Color code lookup tests ---
// These test lookupCode/lookupAllCodes through formatFeatureInfo,
// covering all encoding formats: integer, comma-separated, legacy JSON array.

describe("colour code display", () => {
  it("displays single integer colour code", () => {
    const info = formatFeatureInfo("BOYLAT", {
      CATLAM: 1,
      COLOUR: 4,
    });
    const appearance = info.details.find((d) => d.label === "Appearance");
    expect(appearance?.value).toBe("Green");
  });

  it("displays single string colour code", () => {
    const info = formatFeatureInfo("BOYLAT", {
      CATLAM: 1,
      COLOUR: "4",
    });
    const appearance = info.details.find((d) => d.label === "Appearance");
    expect(appearance?.value).toBe("Green");
  });

  it("displays comma-separated colour codes as names", () => {
    const info = formatFeatureInfo("BOYLAT", {
      CATLAM: 1,
      COLOUR: "1,11",
    });
    const appearance = info.details.find((d) => d.label === "Appearance");
    expect(appearance?.value).toBe("White, Orange");
  });

  it("displays multi-colour comma-separated (3 colours)", () => {
    const info = formatFeatureInfo("BOYLAT", {
      CATLAM: 1,
      COLOUR: "4,3,4",
    });
    const appearance = info.details.find((d) => d.label === "Appearance");
    expect(appearance?.value).toBe("Green, Red, Green");
  });

  it("displays legacy JSON array colour codes", () => {
    const info = formatFeatureInfo("BOYLAT", {
      CATLAM: 1,
      COLOUR: '["1","11"]',
    });
    const appearance = info.details.find((d) => d.label === "Appearance");
    expect(appearance?.value).toBe("White, Orange");
  });

  it("handles unknown colour code gracefully", () => {
    const info = formatFeatureInfo("BOYLAT", {
      CATLAM: 1,
      COLOUR: "99",
    });
    const appearance = info.details.find((d) => d.label === "Appearance");
    expect(appearance?.value).toBe("99");
  });

  it("handles comma-separated with unknown code", () => {
    const info = formatFeatureInfo("BOYLAT", {
      CATLAM: 1,
      COLOUR: "4,99",
    });
    const appearance = info.details.find((d) => d.label === "Appearance");
    expect(appearance?.value).toBe("Green, 99");
  });

  it("handles null/undefined colour", () => {
    const info = formatFeatureInfo("BOYLAT", {
      CATLAM: 1,
    });
    const appearance = info.details.find((d) => d.label === "Appearance");
    expect(appearance).toBeUndefined();
  });
});

// --- Status code display ---

describe("status code display", () => {
  it("displays single status code", () => {
    const info = formatFeatureInfo("BOYSPP", {
      STATUS: "1",
    });
    const status = info.details.find((d) => d.label === "Status");
    expect(status?.value).toBe("Permanent");
  });

  it("displays comma-separated status codes", () => {
    const info = formatFeatureInfo("BOYSPP", {
      STATUS: "5,8",
    });
    const status = info.details.find((d) => d.label === "Status");
    expect(status?.value).toBe("Temporary, Private");
  });
});

// --- BOYSPP (special purpose buoy) formatting ---

describe("special purpose buoy formatting", () => {
  it("formats a yellow can special buoy", () => {
    const info = formatFeatureInfo("BOYSPP", {
      OBJNAM: "Anchorage Buoy A",
      LABEL: "A",
      BOYSHP: 2,
      COLOUR: "6",
      STATUS: "1",
    });
    expect(info.type).toBe("Special Purpose Buoy");
    expect(info.details).toContainEqual({
      label: "Appearance",
      value: "Yellow Can",
    });
    expect(info.details).toContainEqual({
      label: "Status",
      value: "Permanent",
    });
  });

  it("formats a white/orange pillar special buoy", () => {
    const info = formatFeatureInfo("BOYSPP", {
      OBJNAM: "Security Zone Buoy 26",
      LABEL: "26",
      BOYSHP: 4,
      COLOUR: "1,11",
      STATUS: "8",
    });
    expect(info.details).toContainEqual({
      label: "Appearance",
      value: "White, Orange Pillar",
    });
    expect(info.details).toContainEqual({
      label: "Status",
      value: "Private",
    });
  });
});

// --- BOYLAT preferred channel buoys ---

describe("preferred channel buoy formatting", () => {
  it("formats a preferred channel to starboard (green dominant)", () => {
    const info = formatFeatureInfo("BOYLAT", {
      OBJNAM: "Junction Buoy PR",
      LABEL: "PR",
      BOYSHP: 4,
      CATLAM: 3,
      COLOUR: "4,3,4",
    });
    expect(info.details).toContainEqual({
      label: "Category",
      value: "Preferred channel to starboard",
    });
    expect(info.details).toContainEqual({
      label: "Appearance",
      value: "Green, Red, Green Pillar",
    });
  });

  it("formats a preferred channel to port (red dominant)", () => {
    const info = formatFeatureInfo("BOYLAT", {
      CATLAM: 4,
      COLOUR: "3,4,3",
      BOYSHP: 1,
    });
    expect(info.details).toContainEqual({
      label: "Category",
      value: "Preferred channel to port",
    });
    expect(info.details).toContainEqual({
      label: "Appearance",
      value: "Red, Green, Red Conical",
    });
  });
});

describe("detail row ordering and dedup", () => {
  it("places Number first, Information near top, Status near last", () => {
    const info = formatFeatureInfo(
      "BOYSPP",
      {
        OBJNAM: "Caution",
        LABEL: "C",
        BOYSHP: 4,
        COLOUR: "6",
        STATUS: "5",
        INFORM: "Seasonal hazard buoy",
      },
      { lng: -71, lat: 42 },
    );
    const labels = info.details.map((d) => d.label);
    expect(labels[0]).toBe("Number");
    expect(labels.indexOf("Information")).toBeLessThan(
      labels.indexOf("Appearance"),
    );
    expect(labels.indexOf("Status")).toBeGreaterThan(
      labels.indexOf("Appearance"),
    );
    expect(labels[labels.length - 1]).toBe("Position");
  });

  it("drops Type row that duplicates the landmark title", () => {
    const info = formatFeatureInfo("LNDMRK", {
      OBJNAM: "Point Loma Light",
      CATLMK: 17, // Tower → sets title type
      CONVIS: 1, // adds [Conspic] to title
      FUNCTN: 33,
      COLOUR: "2,1",
      HEIGHT: 27,
    });
    expect(info.type).toBe("Tower [Conspic]");
    expect(info.details.find((d) => d.label === "Type")).toBeUndefined();
    expect(info.details.find((d) => d.label === "Visibility")).toBeUndefined();
    expect(info.details).toContainEqual({
      label: "Function",
      value: "Light Support",
    });
  });

  it("keeps Type row when CATLMK is multi-valued (title shows only the first)", () => {
    const info = formatFeatureInfo("LNDMRK", {
      CATLMK: "17,3", // Tower, Chimney
    });
    expect(info.type).toBe("Tower");
    expect(info.details).toContainEqual({
      label: "Type",
      value: "Tower, Chimney",
    });
  });
});
