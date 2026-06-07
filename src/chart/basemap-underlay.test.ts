import { describe, expect, it } from "vitest";
import {
  basemapFilename,
  basemapRegionsFromFilenames,
  getBasemapLayers,
  getBasemapSource,
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

describe("getBasemapSource", () => {
  it("returns a pmtiles vector source to z15", () => {
    const source = getBasemapSource("usvi");
    expect(source.type).toBe("vector");
    if (source.type === "vector") {
      expect(source.tiles?.[0]).toContain("pmtiles://");
      expect(source.tiles?.[0]).toContain("basemap-usvi.pmtiles");
      expect(source.maxzoom).toBe(15);
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
});
