import { describe, expect, it } from "vitest";
import {
  getRasterChartLayers,
  getRasterChartSources,
  rasterChartAt,
  rasterChartsFromFilenames,
} from "./raster-charts";

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

describe("chart footprint outlines", () => {
  it("pairs every raster layer with an outline shown below its minZoom", () => {
    const layers = getRasterChartLayers();
    const sources = getRasterChartSources();
    const rasters = layers.filter((l) => l.type === "raster");
    const outlines = layers.filter((l) => l.type === "line");
    expect(rasters.length).toBeGreaterThan(0);
    expect(outlines.length).toBe(rasters.length);
    for (const raster of rasters) {
      const outline = layers.find(
        (l) => l.id === `${raster.source as string}-outline-layer`,
      );
      // Outline visible exactly where the raster is not (below minZoom)
      expect(outline?.maxzoom).toBe(raster.minzoom);
      expect(sources[`${raster.source as string}-outline`]).toBeDefined();
    }
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
