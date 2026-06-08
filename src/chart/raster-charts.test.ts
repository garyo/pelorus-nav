import { describe, expect, it } from "vitest";
import { rasterChartAt, rasterChartsFromFilenames } from "./raster-charts";

describe("rasterChartsFromFilenames", () => {
  it("extracts ids from rnc-<id>.pmtiles filenames", () => {
    const ids = rasterChartsFromFilenames([
      "rnc-bvi.pmtiles",
      "nautical-usvi.pmtiles",
      "basemap-usvi.pmtiles",
      "rnc-foo-bar.pmtiles",
    ]);
    expect([...ids].sort()).toEqual(["bvi", "foo-bar"]);
  });

  it("ignores non-matching names", () => {
    expect(rasterChartsFromFilenames(["rnc-bvi.coverage.geojson"]).size).toBe(
      0,
    );
  });
});

describe("rasterChartAt", () => {
  it("returns the BVI chart for a point inside its footprint", () => {
    // Road Town, Tortola — inside the 25641 neatline.
    const chart = rasterChartAt(-64.6228, 18.4245);
    expect(chart?.id).toBe("bvi");
  });

  it("returns null well outside any chart footprint", () => {
    expect(rasterChartAt(0, 0)).toBeNull();
  });
});
