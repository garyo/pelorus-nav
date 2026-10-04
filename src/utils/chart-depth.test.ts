import { describe, expect, it } from "vitest";
import { chartDepthThreshold } from "./chart-depth";

describe("chartDepthThreshold", () => {
  it("maps feet settings to NOAA's truncated metric contours", () => {
    expect(chartDepthThreshold(6 * 0.3048, "feet")).toBe(1.8);
    expect(chartDepthThreshold(12 * 0.3048, "feet")).toBe(3.6);
    expect(chartDepthThreshold(20 * 0.3048, "feet")).toBe(6.0);
    expect(chartDepthThreshold(30 * 0.3048, "feet")).toBe(9.1);
    expect(chartDepthThreshold(60 * 0.3048, "feet")).toBe(18.2);
  });

  it("recovers the chosen foot from rounded stored defaults", () => {
    // Shipped defaults: 6 ft, 20 ft, 50 ft stored as rounded metres.
    expect(chartDepthThreshold(1.83, "feet")).toBe(1.8);
    expect(chartDepthThreshold(6.1, "feet")).toBe(6.0);
    expect(chartDepthThreshold(15.24, "feet")).toBe(15.2);
  });

  it("snaps fathom settings to half fathoms", () => {
    expect(chartDepthThreshold(1.8288, "fathoms")).toBe(1.8);
    expect(chartDepthThreshold(2.5 * 1.8288, "fathoms")).toBe(4.5);
    expect(chartDepthThreshold(10 * 1.8288, "fathoms")).toBe(18.2);
  });

  it("leaves metric settings unchanged", () => {
    expect(chartDepthThreshold(1.83, "meters")).toBe(1.83);
    expect(chartDepthThreshold(5, "meters")).toBe(5);
  });

  it("is zero for a zero setting", () => {
    expect(chartDepthThreshold(0, "feet")).toBe(0);
  });
});
