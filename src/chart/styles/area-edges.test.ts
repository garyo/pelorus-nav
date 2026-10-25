import {
  type FilterSpecification,
  featureFilter,
} from "@maplibre/maplibre-gl-style-spec";
import type { LayerSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import {
  AREA_EDGE_CLASSES,
  edgeLayerClass,
  edgeSourceLayer,
  SPLIT_EDGES_FLAG,
  withAreaEdgeLayers,
} from "./area-edges";
import { getNauticalLayers } from "./index";

const LINE = 2 as const;
const POLYGON = 3 as const;

/** Whether a layer's filter passes a feature of this geometry and properties. */
function passes(
  layer: LayerSpecification,
  type: typeof LINE | typeof POLYGON,
  properties: Record<string, unknown> = {},
): boolean {
  const filter = (layer as { filter?: FilterSpecification }).filter;
  return featureFilter(filter).filter({ zoom: 14 }, { type, properties });
}

function sourceLayer(layer: LayerSpecification): string | undefined {
  return (layer as { "source-layer"?: string })["source-layer"];
}

/** Layers of lines only (S-57 line primitives, and the compositor's scale
 * boundaries): no rings to split. */
const LINE_ONLY_CLASSES = new Set([
  "CBLOHD",
  "CBLSUB",
  "COALNE",
  "DEPCNT",
  "DWRTCL",
  "FERYRT",
  "NAVLNE",
  "PIPOHD",
  "PIPSOL",
  "RECTRC",
  "SCLBDY",
  "SLOTOP",
  "TSSBND",
]);

describe("withAreaEdgeLayers", () => {
  const layers = getNauticalLayers({ sourceId: "s", detailOffset: 1 });
  const byId = new Map(layers.map((l) => [l.id, l]));
  const twins = layers.filter((l) => l.id.startsWith("s57-edges-"));

  it("follows each area outline layer with a twin on its edges layer", () => {
    expect(twins.length).toBeGreaterThan(20);
    for (const twin of twins) {
      const baseId = twin.id.replace("s57-edges-", "s57-");
      const base = byId.get(baseId);
      expect(base, twin.id).toBeDefined();
      if (!base) continue;
      expect(layers.indexOf(twin)).toBe(layers.indexOf(base) + 1);
      expect(sourceLayer(twin)).toBe(edgeSourceLayer(sourceLayer(base) ?? ""));
      expect(twin.minzoom).toBe(base.minzoom);
      expect(twin.layout).toEqual(base.layout);
      expect(twin.metadata).toEqual(base.metadata);
    }
  });

  it("draws edge lines wherever the outline layer would draw the area", () => {
    for (const twin of twins) {
      const base = byId.get(twin.id.replace("s57-edges-", "s57-"));
      if (!base) continue;
      for (const props of [{}, { WATLEV: 3 }, { CATOBS: "6" }]) {
        expect(passes(twin, LINE, props), twin.id).toBe(
          passes(base, POLYGON, props),
        );
      }
    }
  });

  it("stops outline layers drawing polygons whose edges were split out", () => {
    for (const twin of twins) {
      const base = byId.get(twin.id.replace("s57-edges-", "s57-"));
      if (!base || !passes(base, POLYGON)) continue;
      expect(passes(base, POLYGON, { [SPLIT_EDGES_FLAG]: 1 }), base.id).toBe(
        false,
      );
    }
  });

  it("adds no twin for an outline layer that only draws lines", () => {
    expect(byId.has("s57-obstrn-line")).toBe(true);
    expect(byId.has("s57-edges-obstrn-line")).toBe(false);
    expect(byId.has("s57-edges-obstrn-area-outline")).toBe(true);
  });

  it("leaves every other layer alone", () => {
    const fill: LayerSpecification = {
      id: "s57-resare-fill",
      type: "fill",
      source: "s",
      "source-layer": "RESARE",
    };
    const contour: LayerSpecification = {
      id: "s57-depcnt",
      type: "line",
      source: "s",
      "source-layer": "DEPCNT",
    };
    expect(withAreaEdgeLayers([fill, contour])).toEqual([fill, contour]);
  });

  it("covers every layer that outlines areas, and only those classes", () => {
    const outlined = new Set<string>();
    for (const layer of layers) {
      const cls = sourceLayer(layer);
      if (layer.type !== "line" || cls === undefined) continue;
      if (layer.id.startsWith("s57-edges-")) continue;
      if (!passes(layer, POLYGON)) continue;
      outlined.add(cls);
      if (!AREA_EDGE_CLASSES.has(cls)) {
        expect(LINE_ONLY_CLASSES, `${layer.id} outlines ${cls}`).toContain(cls);
      }
    }
    for (const cls of AREA_EDGE_CLASSES) {
      expect(outlined, `${cls} has no outline layer`).toContain(cls);
    }
  });

  it("reads edges layers only from line layers", () => {
    for (const layer of layers) {
      const cls = sourceLayer(layer);
      if (cls !== undefined && edgeLayerClass(cls) !== null) {
        expect(layer.type, layer.id).toBe("line");
      }
    }
  });
});

describe("edgeLayerClass", () => {
  it("maps an edges layer back to its area class", () => {
    expect(edgeLayerClass(edgeSourceLayer("RESARE"))).toBe("RESARE");
    expect(edgeLayerClass("RESARE")).toBeNull();
    expect(edgeLayerClass("DEPARE_EDGES")).toBeNull();
  });
});
