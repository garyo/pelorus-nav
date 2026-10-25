/**
 * Area outlines drawn from real edges.
 *
 * Chart tiles are cut along tile edges and along each ENC cell's coverage
 * limit, so a line layer drawing an area's ring traces every cut as if it
 * were a boundary: a phantom grid of dashed lines across large regulated
 * areas. For the classes in tools/area-edges.json the tile compositor puts
 * each polygon's real edges in a separate "<CLASS>_EDGES" line layer and
 * flags the polygon. Every outline layer of those classes therefore stops
 * drawing flagged polygons and gains a twin that draws the edges. Polygons
 * from tiles without the split (older downloads, single-cell tiles) carry
 * no flag, so their rings still draw.
 */

import type { FilterSpecification, LayerSpecification } from "maplibre-gl";
import areaEdges from "../../../tools/area-edges.json";

/** Area classes whose real edges come as a separate line layer. */
export const AREA_EDGE_CLASSES: ReadonlySet<string> = new Set(
  areaEdges.classes,
);

/** Property flagging a polygon whose edges were split out. */
export const SPLIT_EDGES_FLAG = areaEdges.flag;

/** The source layer carrying an area class's real edges. */
export function edgeSourceLayer(areaClass: string): string {
  return areaClass + areaEdges.suffix;
}

/** The area class an edges source layer belongs to, or null if it isn't one. */
export function edgeLayerClass(sourceLayer: string): string | null {
  if (!sourceLayer.endsWith(areaEdges.suffix)) return null;
  const areaClass = sourceLayer.slice(0, -areaEdges.suffix.length);
  return AREA_EDGE_CLASSES.has(areaClass) ? areaClass : null;
}

/**
 * Twin layer id: `s57-resare` → `s57-edges-resare`. The class suffix stays
 * last because feature picking selects layers by it.
 */
function edgesLayerId(id: string): string {
  return id.replace(/^s57-/, "s57-edges-");
}

/**
 * An expression with every `["geometry-type"]` read as "Polygon": the edges
 * belong to a polygon, and the layer's geometry tests were written for it.
 */
function asPolygonEdges<T>(value: T): T {
  if (Array.isArray(value)) {
    if (value.length === 1 && value[0] === "geometry-type") {
      return ["literal", "Polygon"] as T;
    }
    return value.map(asPolygonEdges) as T;
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, asPolygonEdges(v)]),
    ) as T;
  }
  return value;
}

/** Whether a filter can never pass: a constant comparison that fails. */
function neverPasses(filter: unknown): boolean {
  if (!Array.isArray(filter)) return false;
  const [op, ...args] = filter;
  if (op === "all") return args.some(neverPasses);
  if (op === "==" && Array.isArray(args[0]) && args[0][0] === "literal") {
    return typeof args[1] === "string" && args[0][1] !== args[1];
  }
  return false;
}

/**
 * Draw area outlines from real edges: each line layer of an AREA_EDGE_CLASSES
 * source layer skips flagged polygons and is followed by its edges twin.
 */
export function withAreaEdgeLayers(
  layers: LayerSpecification[],
): LayerSpecification[] {
  const skipSplit: FilterSpecification = ["!", ["has", SPLIT_EDGES_FLAG]];
  return layers.flatMap((layer): LayerSpecification[] => {
    if (layer.type !== "line") return [layer];
    const areaClass = layer["source-layer"];
    if (areaClass === undefined || !AREA_EDGE_CLASSES.has(areaClass)) {
      return [layer];
    }
    const rings: LayerSpecification = {
      ...layer,
      filter: layer.filter
        ? (["all", layer.filter, skipSplit] as FilterSpecification)
        : skipSplit,
    };
    const edgesFilter = asPolygonEdges(layer.filter);
    if (neverPasses(edgesFilter)) return [rings];
    const edges: LayerSpecification = {
      ...asPolygonEdges(structuredClone(layer)),
      id: edgesLayerId(layer.id),
      "source-layer": edgeSourceLayer(areaClass),
    };
    return [rings, edges];
  });
}
