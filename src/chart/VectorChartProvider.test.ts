import type { LayerSpecification } from "maplibre-gl";
import { afterEach, describe, expect, it } from "vitest";
import { CHART_REGIONS } from "../data/chart-catalog";
import { getSettings, updateSettings } from "../settings";
import { s52Colour } from "./s52-colours";
import { getNauticalLayers } from "./styles";
import {
  isLayerPrunedAtZoom,
  MAX_PRUNE_BAND,
  VectorChartProvider,
  zoomBandKey,
} from "./VectorChartProvider";

// Stub localStorage for updateSettings in test environment
if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      store: {} as Record<string, string>,
      getItem(key: string) {
        return this.store[key] ?? null;
      },
      setItem(key: string, val: string) {
        this.store[key] = val;
      },
      removeItem(key: string) {
        delete this.store[key];
      },
    },
  });
}

/**
 * Reference implementation of getLayers(): regenerates the full S-52 layer
 * set per region (the pre-template behavior) instead of cloning a shared
 * template. The provider's clone-based output must deep-equal this. `zoom`
 * applies pruning AFTER per-region generation, so equality also proves the
 * provider's prune-then-clone order is equivalent.
 */
function perRegionReference(
  regionIds: string[],
  zoom?: number,
): LayerSpecification[] {
  const {
    depthUnit,
    detailLevel,
    layerGroups,
    displayTheme,
    symbologyScheme,
    shallowDepth,
    safetyDepth,
    deepDepth,
    textScale,
    iconScale,
  } = getSettings();

  const all: LayerSpecification[] = [];
  regionIds.forEach((regionId, i) => {
    const regionLayers = getNauticalLayers({
      sourceId: `s57-vector-${regionId}`,
      depthUnit,
      detailOffset: detailLevel,
      layerGroups,
      theme: displayTheme,
      symbology: symbologyScheme,
      shallowDepth,
      safetyDepth,
      deepDepth,
      textScale,
      iconScale,
    });
    const kept =
      zoom === undefined
        ? regionLayers
        : regionLayers.filter((l) => !isLayerPrunedAtZoom(l, zoom));
    for (const layer of kept) {
      if (layer.type === "background") {
        if (i === 0) all.push(layer);
        continue;
      }
      all.push({
        ...layer,
        id: layer.id.replace(/^s57-/, `s57-${regionId}-`),
      });
    }
  });

  const base = all.filter((l) => l.type !== "symbol");
  const symbols = all.filter((l) => l.type === "symbol");
  base.push({
    id: "s57-no-coverage",
    type: "fill",
    source: "s57-coverage-unified",
    paint: {
      "fill-color": s52Colour("NODTA"),
      "fill-opacity": 0.4,
    },
  });
  return [...base, ...symbols];
}

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

  describe("template cloning matches per-region generation", () => {
    const twoRegions = CHART_REGIONS.slice(0, 2).map((r) => r.id);
    const savedDetail = getSettings().detailLevel;
    afterEach(() => updateSettings({ detailLevel: savedDetail }));

    it("deep-equals per-region regeneration at Standard detail", () => {
      // detailLevel 0 exercises both minzoom-mutation paths in
      // getNauticalLayers (OTHER overrides + raised STANDARD navaids), so
      // this also proves those mutations land on the template before
      // cloning and reach every region identically.
      updateSettings({ detailLevel: 0 });
      expect(provider.getLayers(twoRegions)).toEqual(
        perRegionReference(twoRegions),
      );
    });

    it("deep-equals per-region regeneration at Standard+ detail", () => {
      updateSettings({ detailLevel: 1 });
      expect(provider.getLayers(twoRegions)).toEqual(
        perRegionReference(twoRegions),
      );
    });

    it("no template source id leaks into the emitted layers", () => {
      const layers = provider.getLayers(twoRegions);
      for (const layer of layers) {
        if ("source" in layer) {
          expect(layer.source).not.toBe("s57-template");
        }
      }
    });

    it("deep-equals per-region regeneration with pruning at zoom 8", () => {
      // The reference prunes AFTER per-region generation; the provider
      // prunes the template BEFORE cloning. Equality proves the orders
      // are equivalent (prefixing, background handling, draw-order sort).
      updateSettings({ detailLevel: 0 });
      expect(provider.getLayers(twoRegions, 8)).toEqual(
        perRegionReference(twoRegions, 8),
      );
    });
  });

  describe("zoomBandKey", () => {
    it("is stable within a band and differs across bands", () => {
      expect(zoomBandKey(5.1)).toBe(5);
      expect(zoomBandKey(5.9)).toBe(5);
      expect(zoomBandKey(6.0)).toBe(6);
      expect(zoomBandKey(5.9)).not.toBe(zoomBandKey(6.0));
    });

    it("clamps to [0, MAX_PRUNE_BAND]", () => {
      expect(zoomBandKey(-0.5)).toBe(0);
      expect(zoomBandKey(13.7)).toBe(MAX_PRUNE_BAND);
      expect(zoomBandKey(16)).toBe(MAX_PRUNE_BAND);
    });
  });

  describe("zoom-band layer pruning", () => {
    const regionId = CHART_REGIONS[0].id;
    const savedDetail = getSettings().detailLevel;
    afterEach(() => updateSettings({ detailLevel: savedDetail }));

    it("overview zoom keeps only layers renderable within the margin", () => {
      const full = provider.getLayers([regionId]);
      const pruned = provider.getLayers([regionId], 3);
      expect(pruned.length).toBeLessThan(full.length);
      for (const layer of pruned) {
        const minzoom = layer.minzoom;
        expect(minzoom === undefined || minzoom <= 4).toBe(true);
      }
      // Everything the pruned style keeps is in the full style, unchanged.
      const fullById = new Map(full.map((l) => [l.id, l]));
      for (const layer of pruned) {
        expect(fullById.get(layer.id)).toEqual(layer);
      }
    });

    it("harbor zoom keeps everything", () => {
      const full = provider.getLayers([regionId]);
      expect(provider.getLayers([regionId], 14)).toEqual(full);
      // MAX_PRUNE_BAND is the last band where nothing may prune; verify the
      // constant still covers the styles' largest minzoom.
      expect(provider.getLayers([regionId], MAX_PRUNE_BAND)).toEqual(full);
    });

    it("no zoom argument disables pruning", () => {
      // siltnk carries the styles' highest minzoom (14 at Standard detail);
      // without a zoom it must still be present.
      updateSettings({ detailLevel: 0 });
      const ids = provider.getLayers([regionId]).map((l) => l.id);
      expect(ids).toContain(`s57-${regionId}-siltnk`);
    });

    it("honors the one-level margin below a layer's minzoom", () => {
      // At Standard detail s57-boylat's effective minzoom is 10 (raised
      // from its base 8 by STANDARD_DETAIL_MINZOOM).
      updateSettings({ detailLevel: 0 });
      const idsAt9 = provider.getLayers([regionId], 9.0).map((l) => l.id);
      const idsBelow9 = provider.getLayers([regionId], 8.9).map((l) => l.id);
      expect(idsAt9).toContain(`s57-${regionId}-boylat`);
      expect(idsBelow9).not.toContain(`s57-${regionId}-boylat`);
    });

    it("pruned set is constant within a band and differs across bands", () => {
      expect(provider.getLayers([regionId], 8.1)).toEqual(
        provider.getLayers([regionId], 8.9),
      );
      expect(provider.getLayers([regionId], 7.9)).not.toEqual(
        provider.getLayers([regionId], 8.1),
      );
    });

    it("never prunes background or the coverage mask", () => {
      const ids = provider.getLayers([regionId], 0).map((l) => l.id);
      expect(ids).toContain("s57-background");
      expect(ids).toContain("s57-no-coverage");
    });

    it("composes with detail-level minzoom raises", () => {
      // Standard detail raises boylat to minzoom 10 → pruned at z8.
      updateSettings({ detailLevel: 0 });
      expect(provider.getLayers([regionId], 8).map((l) => l.id)).not.toContain(
        `s57-${regionId}-boylat`,
      );
      // Standard+ keeps boylat's base minzoom 8 → present at z8.
      updateSettings({ detailLevel: 1 });
      expect(provider.getLayers([regionId], 8).map((l) => l.id)).toContain(
        `s57-${regionId}-boylat`,
      );
    });
  });
});
