import { describe, expect, it } from "vitest";
import { NOAAChartProvider } from "./NOAAChartProvider";

describe("NOAAChartProvider", () => {
  const provider = new NOAAChartProvider();

  it("has correct id and name", () => {
    expect(provider.id).toBe("noaa-ncds");
    expect(provider.name).toBe("NOAA Nautical Charts");
    expect(provider.type).toBe("raster");
  });

  it("returns a raster source using NOAA WMS endpoint", () => {
    const source = provider.getSource();
    expect(source.type).toBe("raster");
    if (source.type === "raster") {
      expect(source.tiles).toHaveLength(1);
      const url = source.tiles?.[0] ?? "";
      expect(url).toContain("charttools.noaa.gov");
      expect(url).toContain("WMSServer");
      expect(url).toContain("{bbox-epsg-3857}");
      expect(source.tileSize).toBe(256);
    }
  });

  it("returns a single raster layer", () => {
    const layers = provider.getLayers();
    expect(layers).toHaveLength(1);
    expect(layers[0].type).toBe("raster");
    const layer = layers[0];
    if (layer.type === "raster") {
      expect(layer.source).toBe("noaa-ncds");
    }
  });

  it("returns NOAA attribution", () => {
    expect(provider.getAttribution()).toContain("NOAA");
  });

  it("has zoom range 3-18", () => {
    expect(provider.minZoom).toBe(3);
    expect(provider.maxZoom).toBe(18);
  });
});
