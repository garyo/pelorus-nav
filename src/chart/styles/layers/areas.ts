/**
 * Area layer definitions: background, depth areas, land, coastline,
 * lakes, rivers, dredged areas, pontoons, buildings, unsurveyed areas.
 *
 * Note: COALNE (coastline) is a line layer but lives here because it
 * is interleaved between land and lake fills in the draw order.
 */
import type { LayerSpecification } from "maplibre-gl";
import type { StyleContext } from "../style-context";
import { SCALE_SORT_KEY } from "../style-context";

export function getAreaLayers(ctx: StyleContext): LayerSpecification[] {
  return [
    // ── Background ──────────────────────────────────────────────────────
    {
      id: "s57-background",
      type: "background",
      paint: {
        "background-color": ctx.colour("DEPDW"),
      },
    },

    // ── Fill layers: terrain ─────────────────────────────────────────────
    {
      id: "s57-depare-shallow",
      type: "fill",
      source: ctx.sourceId,
      "source-layer": "DEPARE",
      filter: ["<", ["get", "DRVAL1"], ctx.shallowDepth],
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": ctx.colour("DEPVS"),
        "fill-opacity": 1,
      },
    },
    {
      id: "s57-depare-medium",
      type: "fill",
      source: ctx.sourceId,
      "source-layer": "DEPARE",
      filter: [
        "all",
        [">=", ["get", "DRVAL1"], ctx.shallowDepth],
        ["<", ["get", "DRVAL1"], ctx.deepDepth],
      ],
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": ctx.colour("DEPMS"),
        "fill-opacity": 1,
      },
    },
    {
      id: "s57-depare-deep",
      type: "fill",
      source: ctx.sourceId,
      "source-layer": "DEPARE",
      filter: [">=", ["get", "DRVAL1"], ctx.deepDepth],
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": ctx.colour("DEPDW"),
        "fill-opacity": 1,
      },
    },
    {
      id: "s57-depare-drying",
      type: "fill",
      source: ctx.sourceId,
      "source-layer": "DEPARE",
      filter: ["<", ["get", "DRVAL1"], 0],
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": ctx.colour("DEPIT"),
        "fill-opacity": 0.9,
      },
    },
    {
      id: "s57-lndare",
      type: "fill",
      source: ctx.sourceId,
      "source-layer": "LNDARE",
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": ctx.colour("LANDA"),
        "fill-opacity": 1,
      },
    },
    // Bridge piers / pilings encoded as LNDARE points
    {
      id: "s57-lndare-point",
      type: "circle",
      source: ctx.sourceId,
      "source-layer": "LNDARE",
      minzoom: ctx.detailMinzoom(13),
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 4,
        "circle-color": ctx.colour("CHBRN"),
        "circle-stroke-color": ctx.colour("CHBLK"),
        "circle-stroke-width": 1,
      },
    },
    // Coastline — interleaved here between land and lake fills
    {
      id: "s57-coalne",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "COALNE",
      layout: { "line-sort-key": SCALE_SORT_KEY },
      paint: {
        "line-color": ctx.colour("CSTLN"),
        "line-width": 1.5,
      },
    },
    {
      id: "s57-lakare",
      type: "fill",
      source: ctx.sourceId,
      "source-layer": "LAKARE",
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": ctx.colour("DEPMD"),
        "fill-opacity": 0.8,
      },
    },
    {
      id: "s57-rivers",
      type: "fill",
      source: ctx.sourceId,
      "source-layer": "RIVERS",
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": ctx.colour("DEPMD"),
        "fill-opacity": 0.8,
      },
    },
    {
      id: "s57-drgare",
      type: "fill",
      source: ctx.sourceId,
      "source-layer": "DRGARE",
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": ctx.colour("DEPMS"),
        "fill-opacity": 0.5,
      },
    },
    {
      id: "s57-drgare-outline",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "DRGARE",
      layout: { "line-sort-key": SCALE_SORT_KEY },
      paint: {
        "line-color": ctx.colour("RADHI"),
        "line-width": 1,
        "line-dasharray": [4, 3],
      },
    },
    {
      id: "s57-ponton",
      type: "fill",
      source: ctx.sourceId,
      "source-layer": "PONTON",
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": ctx.colour("NODTA"),
        "fill-opacity": 0.8,
      },
    },
    {
      id: "s57-buisgl",
      type: "fill",
      source: ctx.sourceId,
      "source-layer": "BUISGL",
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": ctx.colour("LANDF"),
        "fill-opacity": 0.7,
      },
    },
    {
      id: "s57-buisgl-outline",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "BUISGL",
      layout: { "line-sort-key": SCALE_SORT_KEY },
      paint: {
        "line-color": ctx.colour("PAYLC"),
        "line-width": 0.5,
      },
    },
    {
      id: "s57-unsare",
      type: "fill",
      source: ctx.sourceId,
      "source-layer": "UNSARE",
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": ctx.colour("NODTA"),
        "fill-opacity": 0.3,
      },
    },
  ];
}

/** Coverage mask layer: shades areas outside chart coverage. */
export function getCoverageLayers(ctx: StyleContext): LayerSpecification[] {
  if (!ctx.coverageSourceId) return [];
  return [
    {
      id: "s57-no-coverage",
      type: "fill" as const,
      source: ctx.coverageSourceId,
      paint: {
        "fill-color": ctx.colour("NODTA"),
        "fill-opacity": 0.4,
      },
    },
  ];
}
