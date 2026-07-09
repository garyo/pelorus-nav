import { TileType } from "pmtiles";
import { describe, expect, it } from "vitest";
import { CHART_REGIONS, RASTER_CHARTS } from "../data/chart-catalog";
import {
  isCatalogFilename,
  type PMTilesLike,
  rasterChartFromPMTiles,
} from "./imported-charts";

type Header = Awaited<ReturnType<PMTilesLike["getHeader"]>>;

function stub(header: Partial<Header>, metadata: unknown = null): PMTilesLike {
  return {
    getHeader: async () => ({
      tileType: TileType.Png,
      minZoom: 4,
      maxZoom: 12,
      minLon: -65,
      minLat: 17,
      maxLon: -64,
      maxLat: 18,
      ...header,
    }),
    getMetadata: async () => metadata,
  };
}

describe("rasterChartFromPMTiles", () => {
  it("derives a raster chart from the archive header", async () => {
    const chart = await rasterChartFromPMTiles(
      stub({}),
      "fiji-sat.pmtiles",
      42,
    );
    expect(chart).not.toBeNull();
    expect(chart?.id).toBe("import-fiji-sat");
    expect(chart?.name).toBe("fiji-sat");
    expect(chart?.filename).toBe("fiji-sat.pmtiles");
    expect(chart?.bbox).toEqual([-65, 17, -64, 18]);
    expect(chart?.minZoom).toBe(4);
    expect(chart?.maxZoom).toBe(12);
    expect(chart?.nativeZoom).toBe(12);
    expect(chart?.sizeEstimate).toBe(42);
    expect(chart?.imported).toBe(true);
    // Center is always the bbox centroid (header centers are unreliable)
    expect(chart?.center).toEqual([-64.5, 17.5]);
  });

  it("takes name from metadata and strips HTML from attribution", async () => {
    const chart = await rasterChartFromPMTiles(
      stub(
        {},
        { name: "Fiji Sat", attribution: '<a href="x">Imagery © Foo</a>' },
      ),
      "a.pmtiles",
      1,
    );
    expect(chart?.name).toBe("Fiji Sat");
    expect(chart?.attribution).toBe("Imagery © Foo");
  });

  it("defaults attribution when metadata has none", async () => {
    const chart = await rasterChartFromPMTiles(stub({}), "a.pmtiles", 1);
    expect(chart?.attribution).toBe("Imported chart");
  });

  it("returns null for vector archives", async () => {
    expect(
      await rasterChartFromPMTiles(
        stub({ tileType: TileType.Mvt }),
        "v.pmtiles",
        1,
      ),
    ).toBeNull();
  });
});

describe("isCatalogFilename", () => {
  it("recognizes catalog region, basemap, and raster filenames", () => {
    expect(isCatalogFilename(CHART_REGIONS[0].filename)).toBe(true);
    const withBasemap = CHART_REGIONS.find((r) => r.basemapFilename);
    if (withBasemap?.basemapFilename) {
      expect(isCatalogFilename(withBasemap.basemapFilename)).toBe(true);
    }
    expect(isCatalogFilename(RASTER_CHARTS[0].filename)).toBe(true);
  });

  it("rejects unknown filenames", () => {
    expect(isCatalogFilename("fiji-sat.pmtiles")).toBe(false);
  });
});
