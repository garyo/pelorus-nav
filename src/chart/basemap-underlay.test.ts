import { describe, expect, it } from "vitest";
import {
  BASEMAP_LABEL_SOURCE_ID,
  BASEMAP_SOURCE_ID,
  basemapFilename,
  basemapRegionsFromFilenames,
  getBasemapLayers,
  getBasemapSources,
  hasStoredBasemap,
  setStoredBasemaps,
} from "./basemap-underlay";

describe("basemapFilename", () => {
  it("builds the per-region filename", () => {
    expect(basemapFilename("northern-new-england")).toBe(
      "basemap-northern-new-england.pmtiles",
    );
  });
});

describe("basemapRegionsFromFilenames", () => {
  it("extracts region ids from basemap filenames only", () => {
    const ids = basemapRegionsFromFilenames([
      "nautical-usvi.pmtiles",
      "basemap-northern-new-england.pmtiles",
      "basemap-usvi.pmtiles",
      "random.pmtiles",
    ]);
    expect(ids).toEqual(new Set(["northern-new-england", "usvi"]));
  });
});

describe("stored basemap registry", () => {
  it("tracks stored region ids", () => {
    setStoredBasemaps(new Set(["usvi"]));
    expect(hasStoredBasemap("usvi")).toBe(true);
    expect(hasStoredBasemap("northern-new-england")).toBe(false);
    setStoredBasemaps(new Set());
    expect(hasStoredBasemap("usvi")).toBe(false);
  });
});

describe("getBasemapSources", () => {
  const sources = getBasemapSources("usvi");

  it("returns a pmtiles vector source to z15", () => {
    const source = sources[BASEMAP_SOURCE_ID];
    expect(source.type).toBe("vector");
    if (source.type === "vector") {
      expect(source.tiles?.[0]).toContain("pmtiles://");
      expect(source.tiles?.[0]).toContain("basemap-usvi.pmtiles");
      expect(source.maxzoom).toBe(15);
    }
  });

  it("returns an overscaled label source scoped to z13-14", () => {
    const source = sources[BASEMAP_LABEL_SOURCE_ID];
    expect(source.type).toBe("vector");
    if (source.type === "vector") {
      expect(source.minzoom).toBe(13);
      expect(source.maxzoom).toBe(14);
    }
  });
});

describe("getBasemapLayers", () => {
  const layers = getBasemapLayers("day");

  it("returns a non-empty prefixed layer set", () => {
    expect(layers.length).toBeGreaterThan(10);
    for (const layer of layers) {
      expect(layer.id.startsWith("basemap-")).toBe(true);
    }
  });

  it("contains no background layer (empty tiles must show the chart)", () => {
    expect(layers.some((l) => l.type === "background")).toBe(false);
  });

  it("contains no icon-image references (sprites not bundled)", () => {
    for (const layer of layers) {
      if (layer.type === "symbol") {
        expect(layer.layout?.["icon-image"]).toBeUndefined();
      }
    }
  });

  it("remaps every text-font to a bundled Noto Sans stack", () => {
    const bundled = new Set([
      "Noto Sans Regular",
      "Noto Sans Bold",
      "Noto Sans Italic",
    ]);
    let labelled = 0;
    for (const layer of layers) {
      if (layer.type !== "symbol") continue;
      const fonts = layer.layout?.["text-font"];
      if (!fonts) continue;
      labelled++;
      for (const font of fonts as string[]) {
        expect(bundled.has(font)).toBe(true);
      }
    }
    expect(labelled).toBeGreaterThan(0);
  });

  it("themes per display theme", () => {
    const night = getBasemapLayers("night");
    expect(JSON.stringify(night)).not.toEqual(JSON.stringify(layers));
  });

  it("shows minor street names from z13, smaller and denser", () => {
    const minor = layers.find((l) => l.id === "basemap-roads_labels_minor");
    expect(minor?.minzoom).toBe(13);
    if (minor?.type !== "symbol") throw new Error("expected symbol layer");
    expect(minor.layout?.["symbol-spacing"]).toBe(150);
    expect(JSON.stringify(minor.layout?.["text-size"])).toContain("zoom");
    // Laid out against the overscaled source so line-fit succeeds a zoom early
    expect(minor.source).toBe(BASEMAP_LABEL_SOURCE_ID);
  });

  it("shows POI names one zoom earlier than stock", () => {
    const pois = layers.find((l) => l.id === "basemap-pois");
    if (pois?.type !== "symbol") throw new Error("expected symbol layer");
    expect(JSON.stringify(pois.filter)).toContain(
      '[">=",["zoom"],["+",["get","min_zoom"],-1]]',
    );
  });

  it("places POIs below street labels so streets win collisions", () => {
    const ids = layers.map((l) => l.id);
    expect(ids.indexOf("basemap-pois")).toBeLessThan(
      ids.indexOf("basemap-roads_labels_minor"),
    );
  });
});
