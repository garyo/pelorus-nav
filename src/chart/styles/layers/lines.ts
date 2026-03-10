/**
 * Line layer definitions: depth contours, coastline, shoreline constructions,
 * bridges, cables, pipelines.
 */
import type { LayerSpecification } from "maplibre-gl";
import type { StyleContext } from "../style-context";
import { SCALE_SORT_KEY } from "../style-context";

export function getLineLayers(ctx: StyleContext): LayerSpecification[] {
  const layers: LayerSpecification[] = [
    {
      id: "s57-depcnt",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "DEPCNT",
      layout: { "line-sort-key": SCALE_SORT_KEY },
      paint: {
        "line-color": ctx.colour("CHGRD"),
        "line-width": 0.7,
      },
    },
    {
      id: "s57-slcons",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "SLCONS",
      layout: { "line-sort-key": SCALE_SORT_KEY },
      paint: {
        "line-color": ctx.colour("CHGRF"),
        "line-width": 1,
      },
    },
    {
      id: "s57-bridge",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "BRIDGE",
      paint: {
        "line-color": ctx.colour("CHBRN"),
        "line-width": 2,
      },
    },
    {
      id: "s57-cblsub",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "CBLSUB",
      paint: {
        "line-color": ctx.colour("ISDNG"),
        "line-width": 1,
        "line-dasharray": [4, 3],
      },
    },
    {
      id: "s57-cblohd",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "CBLOHD",
      paint: {
        "line-color": ctx.colour("OUTLW"),
        "line-width": 1.2,
        "line-dasharray": [5, 3],
      },
    },
  ];

  return layers;
}

/** STANDARD-category additional line layers: dykes, slopes, gates, dams. */
export function getAdditionalLineLayers(
  ctx: StyleContext,
): LayerSpecification[] {
  return [
    {
      id: "s57-dykcon",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "DYKCON",
      paint: {
        "line-color": ctx.colour("CHBRN"),
        "line-width": 1.5,
      },
    },
    {
      id: "s57-slotop",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "SLOTOP",
      paint: {
        "line-color": ctx.colour("CHBRN"),
        "line-width": 1,
        "line-dasharray": [3, 2] as number[],
      },
    },
    {
      id: "s57-gatcon",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "GATCON",
      paint: {
        "line-color": ctx.colour("CHBLK"),
        "line-width": 2,
      },
    },
    {
      id: "s57-damcon",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "DAMCON",
      paint: {
        "line-color": ctx.colour("CHBLK"),
        "line-width": 1.5,
      },
    },
  ];
}

/** OTHER-category line layers: cable areas, pipe areas, pipelines. */
export function getOtherLineLayers(ctx: StyleContext): LayerSpecification[] {
  return [
    {
      id: "s57-cblare",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "CBLARE",
      paint: {
        "line-color": ctx.colour("ISDNG"),
        "line-width": 1,
        "line-dasharray": [4, 3] as number[],
        "line-opacity": 0.5,
      },
    },
    {
      id: "s57-pipare",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "PIPARE",
      paint: {
        "line-color": ctx.colour("ISDNG"),
        "line-width": 1,
        "line-dasharray": [4, 3] as number[],
        "line-opacity": 0.5,
      },
    },
    {
      id: "s57-pipsol",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "PIPSOL",
      paint: {
        "line-color": ctx.colour("ISDNG"),
        "line-width": 1,
        "line-dasharray": [4, 3] as number[],
      },
    },
  ];
}
