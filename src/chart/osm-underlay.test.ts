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
    id: "s57-boston-test-buisgl",
    type: "fill",
    source: "s57",
    "source-layer": "BUISGL",
    paint: { "fill-color": "#8b7355", "fill-opacity": 0.7 },
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
    expect(land?.type === "fill" && land.paint?.["fill-opacity"]).toBe(1);
    expect(land?.type === "fill" && land.paint?.["fill-layer-opacity"]).toBe(
      0.3,
    );
  });

  it("dims buildings slightly less than land, as a whole layer", () => {
    const bld = byId.get("s57-boston-test-buisgl");
    expect(bld?.type === "fill" && bld.paint?.["fill-opacity"]).toBe(1);
    expect(bld?.type === "fill" && bld.paint?.["fill-layer-opacity"]).toBe(0.4);
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

describe("applyOSMUnderlay land tinting", () => {
  const paintOf = (layers: LayerSpecification[], id: string) =>
    (layers.find((l) => l.id === id) as { paint?: Record<string, unknown> })
      ?.paint ?? {};

  it("tints with fill-layer-opacity when the composite is trusted", () => {
    const out = applyOSMUnderlay(s57Layers, 0.3, "day");
    expect(paintOf(out, "s57-boston-test-lndare")).toMatchObject({
      "fill-opacity": 1,
      "fill-layer-opacity": 0.3,
    });
    // Buildings sit a touch more opaque than the land under them.
    expect(paintOf(out, "s57-boston-test-buisgl")).toMatchObject({
      "fill-opacity": 1,
      "fill-layer-opacity": 0.4,
    });
  });

  it("falls back to per-feature fill-opacity when it is not", () => {
    const out = applyOSMUnderlay(s57Layers, 0.3, "day", {
      layerOpacitySupported: false,
    });
    const land = paintOf(out, "s57-boston-test-lndare");
    expect(land["fill-opacity"]).toBe(0.3);
    // The broken property must be gone, not merely overridden: leaving it in
    // is what dims the whole chart on the stacks this fallback exists for.
    expect(land).not.toHaveProperty("fill-layer-opacity");
    const buildings = paintOf(out, "s57-boston-test-buisgl");
    expect(buildings["fill-opacity"]).toBe(0.4);
    expect(buildings).not.toHaveProperty("fill-layer-opacity");
  });

  it("leaves everything else alone on the fallback path", () => {
    const trusted = applyOSMUnderlay(s57Layers, 0.3, "day");
    const fallback = applyOSMUnderlay(s57Layers, 0.3, "day", {
      layerOpacitySupported: false,
    });
    expect(fallback.map((l) => l.id)).toEqual(trusted.map((l) => l.id));
    // Water still hides the underlay, and the background still steps aside.
    expect(paintOf(fallback, "s57-boston-test-lakare")).toMatchObject({
      "fill-opacity": 1,
    });
    expect(paintOf(fallback, "s57-background")).toMatchObject({
      "background-opacity": 0,
    });
  });
});
