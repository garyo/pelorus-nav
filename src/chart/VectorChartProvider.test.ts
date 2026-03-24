import { describe, expect, it } from "vitest";
import { CHART_REGIONS } from "../data/chart-catalog";
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

  it("getSources includes all region vector sources and unified coverage", () => {
    const sources = provider.getSources();
    // All regions + unified coverage
    expect(Object.keys(sources)).toHaveLength(CHART_REGIONS.length + 1);

    // Each region has a consistently named source
    for (const region of CHART_REGIONS) {
      const sourceId = `s57-vector-${region.id}`;
      expect(sources[sourceId]).toBeDefined();
      expect(sources[sourceId].type).toBe("vector");
    }

    // Unified coverage source
    expect(sources["s57-coverage-unified"]).toBeDefined();
  });

  it("first region source contains correct pmtiles URL", () => {
    const sources = provider.getSources();
    const firstId = `s57-vector-${CHART_REGIONS[0].id}`;
    const source = sources[firstId];
    expect(source.type).toBe("vector");
    if (source.type === "vector") {
      expect(source.tiles?.[0]).toContain("pmtiles://");
      expect(source.tiles?.[0]).toContain("{z}/{x}/{y}");
      expect(source.tiles?.[0]).toContain(
        "nautical-northern-new-england.pmtiles",
      );
    }
  });

  it("setActiveRegion changes the active region", () => {
    const p = new VectorChartProvider("northern-new-england");
    expect(p.setActiveRegion("usvi")).toBe(true);
    expect(p.getRegion().id).toBe("usvi");
    // No-op for same region
    expect(p.setActiveRegion("usvi")).toBe(false);
  });

  it("returns layers for ALL regions with prefixed IDs", () => {
    const layers = provider.getLayers();
    expect(layers.length).toBeGreaterThan(0);

    const layerIds = layers.map((l) => l.id);

    // Background layer (only one, unprefixed)
    expect(layerIds).toContain("s57-background");

    // First region layers are prefixed with region ID
    const firstRegion = CHART_REGIONS[0].id;
    expect(layerIds).toContain(`s57-${firstRegion}-lndare`);
    expect(layerIds).toContain(`s57-${firstRegion}-depare-shallow`);
    expect(layerIds).toContain(`s57-${firstRegion}-soundg`);
    expect(layerIds).toContain(`s57-${firstRegion}-boylat`);

    // Second region layers also present
    if (CHART_REGIONS.length > 1) {
      const secondRegion = CHART_REGIONS[1].id;
      expect(layerIds).toContain(`s57-${secondRegion}-lndare`);
      expect(layerIds).toContain(`s57-${secondRegion}-soundg`);
    }
  });

  it("only one background layer across all regions", () => {
    const layers = provider.getLayers();
    const bgLayers = layers.filter((l) => l.type === "background");
    expect(bgLayers).toHaveLength(1);
    expect(bgLayers[0].id).toBe("s57-background");
  });

  it("single unified coverage mask layer", () => {
    const layers = provider.getLayers();
    const coverageLayers = layers.filter((l) => l.id === "s57-no-coverage");
    expect(coverageLayers).toHaveLength(1);
    expect(coverageLayers[0]).toMatchObject({
      type: "fill",
      source: "s57-coverage-unified",
    });
  });

  it("all layers reference a valid source", () => {
    const layers = provider.getLayers();
    const sources = provider.getSources();
    const validSources = new Set(Object.keys(sources));

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
