import { describe, expect, it } from "vitest";
import { VectorChartProvider } from "./VectorChartProvider";

describe("VectorChartProvider", () => {
  const provider = new VectorChartProvider();

  it("has correct id and name", () => {
    expect(provider.id).toBe("s57-vector");
    expect(provider.name).toBe("NOAA Vector Charts");
  });

  it("has vector type", () => {
    expect(provider.type).toBe("vector");
  });

  it("returns vector source with pmtiles tiles URL", () => {
    const source = provider.getSource();
    expect(source.type).toBe("vector");
    if (source.type === "vector") {
      expect(source.tiles?.[0]).toContain("pmtiles://");
      expect(source.tiles?.[0]).toContain("{z}/{x}/{y}");
    }
  });

  it("accepts custom pmtiles URL", () => {
    const custom = new VectorChartProvider("pmtiles:///custom.pmtiles");
    const source = custom.getSource();
    if (source.type === "vector") {
      expect(source.tiles?.[0]).toBe("pmtiles:///custom.pmtiles/{z}/{x}/{y}");
    }
  });

  it("returns nautical chart layers", () => {
    const layers = provider.getLayers();
    expect(layers.length).toBeGreaterThan(0);

    // Check key layers exist
    const layerIds = layers.map((l) => l.id);
    expect(layerIds).toContain("s57-background");
    expect(layerIds).toContain("s57-lndare");
    expect(layerIds).toContain("s57-depare-shallow");
    expect(layerIds).toContain("s57-coalne");
    expect(layerIds).toContain("s57-soundg");
    expect(layerIds).toContain("s57-boylat");
    expect(layerIds).toContain("s57-wrecks");
    expect(layerIds).toContain("s57-drgare");
    expect(layerIds).toContain("s57-slcons");
    expect(layerIds).toContain("s57-fairwy");
  });

  it("all layers reference a valid source", () => {
    const layers = provider.getLayers();
    const validSources = new Set(["s57-vector", "s57-coverage"]);
    for (const layer of layers) {
      if ("source" in layer && layer.source) {
        expect(validSources).toContain(layer.source);
      }
    }
  });

  it("returns NOAA attribution", () => {
    expect(provider.getAttribution()).toContain("NOAA");
  });
});
