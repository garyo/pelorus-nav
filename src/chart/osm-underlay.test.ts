import type { LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { applyOSMUnderlay, getOSMUnderlaySource } from "./osm-underlay";

const s57Layers: LayerSpecification[] = [
  {
    id: "s57-background",
    type: "background",
    paint: { "background-color": "#c0d9e4" },
  },
  {
    id: "s57-boston-test-lndare",
    type: "fill",
    source: "s57",
    "source-layer": "LNDARE",
    paint: { "fill-color": "#d2b48c" },
  },
  {
    id: "s57-boston-test-lakare",
    type: "fill",
    source: "s57",
    "source-layer": "LAKARE",
    paint: { "fill-color": "#9bc4e2", "fill-opacity": 0.8 },
  },
  {
    id: "s57-boston-test-soundg",
    type: "symbol",
    source: "s57",
    "source-layer": "SOUNDG",
  },
];

describe("getOSMUnderlaySource", () => {
  it("uses the cached OSM tile protocol", () => {
    expect(getOSMUnderlaySource().source.tiles[0]).toBe(
      "osmtiles://{z}/{x}/{y}",
    );
  });
});

describe("applyOSMUnderlay", () => {
  const result = applyOSMUnderlay(s57Layers, 0.3, "day");
  const ids = result.map((l) => l.id);
  const byId = new Map(result.map((l) => [l.id, l]));

  it("places full-opacity background and land fallbacks below the OSM layer", () => {
    const osmIndex = ids.indexOf("osm-underlay-layer");
    const bgFallback = ids.indexOf("s57-background-osm-fallback");
    const landFallback = ids.indexOf("s57-boston-test-lndare-osm-fallback");
    expect(bgFallback).toBeGreaterThanOrEqual(0);
    expect(landFallback).toBeGreaterThanOrEqual(0);
    expect(bgFallback).toBeLessThan(osmIndex);
    expect(landFallback).toBeLessThan(osmIndex);
    // Fallback copies keep their original (full) opacity
    const bg = byId.get("s57-background-osm-fallback");
    expect(bg?.type === "background" && bg.paint?.["background-opacity"]).toBe(
      undefined,
    );
    const land = byId.get("s57-boston-test-lndare-osm-fallback");
    expect(land?.type === "fill" && land.paint?.["fill-opacity"]).toBe(
      undefined,
    );
  });

  it("makes the main background transparent and dims land above OSM", () => {
    const bg = byId.get("s57-background");
    expect(bg?.type === "background" && bg.paint?.["background-opacity"]).toBe(
      0,
    );
    const land = byId.get("s57-boston-test-lndare");
    expect(land?.type === "fill" && land.paint?.["fill-opacity"]).toBe(0.3);
  });

  it("makes water-area fills fully opaque", () => {
    const lake = byId.get("s57-boston-test-lakare");
    expect(lake?.type === "fill" && lake.paint?.["fill-opacity"]).toBe(1);
  });

  it("preserves layer count plus OSM and fallback layers", () => {
    expect(result).toHaveLength(s57Layers.length + 3);
    expect(ids.indexOf("s57-boston-test-soundg")).toBeGreaterThan(
      ids.indexOf("osm-underlay-layer"),
    );
  });
});
