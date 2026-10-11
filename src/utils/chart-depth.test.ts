import { describe, expect, it } from "vitest";
import { chartDepthThreshold, migrateV2DepthSetting } from "./chart-depth";

const FT = 0.3048;
const FM = 1.8288;

describe("chartDepthThreshold", () => {
  it("converts feet settings exactly, as NOAA Custom Chart compares them", () => {
    // NOAA's 6 ft contour is stored as 1.8 m: a 5 ft setting selects it,
    // a 6 ft setting (1.8288 m) passes it for the next deeper contour.
    expect(chartDepthThreshold(5 * FT, "feet")).toBeCloseTo(1.524, 9);
    expect(chartDepthThreshold(5 * FT, "feet")).toBeLessThan(1.8);
    expect(chartDepthThreshold(6 * FT, "feet")).toBeGreaterThan(1.8);
    expect(chartDepthThreshold(11 * FT, "feet")).toBeLessThan(3.6);
    expect(chartDepthThreshold(17 * FT, "feet")).toBeLessThan(5.4);
  });

  it("recovers the chosen foot from inexactly stored settings", () => {
    expect(chartDepthThreshold(1.83, "feet")).toBe(6 * FT);
    expect(chartDepthThreshold(11 / 3.28084, "feet")).toBe(11 * FT);
  });

  it("snaps fathom settings to half fathoms", () => {
    expect(chartDepthThreshold(1.83, "fathoms")).toBe(FM);
    expect(chartDepthThreshold(2.5 * FM + 0.01, "fathoms")).toBe(2.5 * FM);
  });

  it("leaves metric settings unchanged", () => {
    expect(chartDepthThreshold(1.83, "meters")).toBe(1.83);
    expect(chartDepthThreshold(5, "meters")).toBe(5);
  });

  it("is zero for a zero setting", () => {
    expect(chartDepthThreshold(0, "feet")).toBe(0);
  });
});

describe("migrateV2DepthSetting", () => {
  /** The v3 setting a v2 feet setting becomes, in feet. */
  const migratedFeet = (ft: number) =>
    Math.round(migrateV2DepthSetting(ft * FT, "feet") / FT);

  it("rewrites feet settings to the label of the contour v2 selected", () => {
    expect(migratedFeet(6)).toBe(5); // 1.8 m contour
    expect(migratedFeet(12)).toBe(11); // 3.6 m
    expect(migratedFeet(20)).toBe(19); // 6.0 m
    expect(migratedFeet(30)).toBe(29); // 9.1 m
    expect(migratedFeet(0)).toBe(0);
  });

  it("keeps selecting the whole-foot contour v2 selected", () => {
    /** A whole-foot contour as NOAA stores it, truncated to 0.1 m. */
    const stored = (ft: number) => Math.floor(ft * FT * 10 + 1e-6) / 10;
    for (const ft of [6, 12, 18, 20, 30, 60]) {
      const v3 = chartDepthThreshold(
        migrateV2DepthSetting(ft * FT, "feet"),
        "feet",
      );
      expect(v3).toBeLessThanOrEqual(stored(ft));
      expect(v3).toBeGreaterThan(stored(ft - 1));
    }
  });

  it("rewrites fathom settings in half-fathom steps", () => {
    expect(migrateV2DepthSetting(FM, "fathoms")).toBeCloseTo(0.5 * FM, 9);
    expect(migrateV2DepthSetting(3 * FM, "fathoms")).toBeCloseTo(2.5 * FM, 9);
  });

  it("leaves metric settings unchanged", () => {
    expect(migrateV2DepthSetting(1.83, "meters")).toBe(1.83);
  });
});
