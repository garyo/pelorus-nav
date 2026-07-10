import { describe, expect, it } from "vitest";
import {
  BASEMAP_LABEL_SOURCE_ID,
  BASEMAP_SOURCE_ID,
  basemapFilename,
  basemapRegionsFromFilenames,
  getBasemapLayers,
  getBasemapSources,
  hasStoredBasemap,
  isViewportCovered,
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

  it("ramps both road label sizes up at dock zooms", () => {
    const sizes = ["minor", "major"].map((k) => {
      const layer = layers.find((l) => l.id === `basemap-roads_labels_${k}`);
      if (layer?.type !== "symbol") throw new Error("expected symbol layer");
      return JSON.stringify(layer.layout?.["text-size"]);
    });
    for (const size of sizes) {
      expect(size).toContain("interpolate");
      expect(size).toContain("18,16"); // both reach 16px at z18
    }
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

describe("isViewportCovered", () => {
  // A 3x3 block of z10 cells around Boston-ish (x 316-318, y 378-380).
  // z10 cell x=316 spans lon [-68.906, -68.555]; y=378 spans lat ~[44.6, 44.8].
  const cells = new Set<string>();
  for (let x = 316; x <= 318; x++) {
    for (let y = 378; y <= 380; y++) cells.add(`${x},${y}`);
  }
  const n = 2 ** 10;
  const lon = (x: number) => (x / n) * 360 - 180;
  const lat = (y: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const cov = {
    zoom: 10,
    cells,
    bbox: [lon(316), lat(381), lon(319), lat(378)] as [
      number,
      number,
      number,
      number,
    ],
  };
  // A small viewport strictly inside the center cell (317, 379)
  const inside: [number, number, number, number] = [
    lon(317) + 0.01,
    lat(380) + 0.01,
    lon(318) - 0.01,
    lat(379) - 0.01,
  ];

  it("true when the viewport lies entirely within covered cells", () => {
    expect(isViewportCovered(cov, inside)).toBe(true);
  });

  it("false for null coverage or viewport (unknown = uncovered)", () => {
    expect(isViewportCovered(null, inside)).toBe(false);
    expect(isViewportCovered(cov, null)).toBe(false);
  });

  it("quick-rejects a viewport outside the coverage hull", () => {
    expect(
      isViewportCovered(cov, [14.7, 44.1, 15.0, 44.3]), // Croatia
    ).toBe(false);
  });

  it("quick-rejects a viewport larger than the whole coverage", () => {
    expect(
      isViewportCovered(
        { ...cov, bbox: [-180, -85, 180, 85] }, // defeat the hull reject
        [-170, -80, 170, 80],
      ),
    ).toBe(false);
  });

  it("false when the viewport touches an uncovered cell", () => {
    // Straddle the east edge of the block into cell x=319
    expect(
      isViewportCovered(cov, [
        lon(318) + 0.01,
        lat(380),
        lon(319) + 0.1,
        lat(379),
      ]),
    ).toBe(false);
  });
});
