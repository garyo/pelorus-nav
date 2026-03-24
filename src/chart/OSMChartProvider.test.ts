import { describe, expect, it } from "vitest";
import { OSMChartProvider } from "./OSMChartProvider";

describe("OSMChartProvider", () => {
  const provider = new OSMChartProvider();

  it("has correct id and name", () => {
    expect(provider.id).toBe("osm");
    expect(provider.name).toBe("OpenStreetMap");
    expect(provider.type).toBe("raster");
  });

  it("returns a raster source with OSM URL", () => {
    const source = provider.getSources()[Object.keys(provider.getSources())[0]];
    expect(source.type).toBe("raster");
    if (source.type === "raster") {
      expect(source.tiles?.[0]).toContain("openstreetmap.org");
    }
  });

  it("returns OpenStreetMap attribution", () => {
    expect(provider.getAttribution()).toContain("OpenStreetMap");
  });

  it("has zoom range 0-19", () => {
    expect(provider.minZoom).toBe(0);
    expect(provider.maxZoom).toBe(19);
  });
});
