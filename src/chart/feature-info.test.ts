import { describe, expect, it } from "vitest";
import { formatFeatureInfo } from "./feature-info";

describe("formatFeatureInfo", () => {
  it("formats a lateral buoy with all attributes", () => {
    const info = formatFeatureInfo("BOYLAT", {
      OBJNAM: "Boston Approach #3",
      LABEL: "3",
      CATLAM: 1,
      BOYSHP: 2,
      COLOUR: "red",
    });
    expect(info.type).toBe("Lateral Buoy");
    expect(info.name).toBe("Boston Approach #3");
    expect(info.details).toContainEqual({ label: "Number", value: '"3"' });
    expect(info.details).toContainEqual({ label: "Category", value: "Port" });
    expect(info.details).toContainEqual({ label: "Shape", value: "Can" });
    expect(info.details).toContainEqual({ label: "Color", value: "red" });
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
    expect(info.details).toContainEqual({ label: "Height", value: "12m" });
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
    expect(info.type).toBe("Wreck");
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
    expect(info.type).toBe("Obstruction");
    expect(info.details).toContainEqual({
      label: "Category",
      value: "Foul ground",
    });
    expect(info.details).toContainEqual({ label: "Depth", value: "1.2m" });
  });

  it("formats an underwater rock", () => {
    const info = formatFeatureInfo("UWTROC", {
      VALSOU: 0.5,
      WATLEV: 4,
    });
    expect(info.type).toBe("Underwater Rock");
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
    expect(info.type).toBe("Depth Area");
    expect(info.details).toContainEqual({
      label: "Depth Range",
      value: "5m - 10m",
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
    // Should include FOO but filter out internal fields
    expect(info.details).toContainEqual({ label: "OBJNAM", value: "Test" });
    expect(info.details).toContainEqual({ label: "FOO", value: "bar" });
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
