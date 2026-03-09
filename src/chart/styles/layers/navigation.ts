/**
 * Navigation layer definitions: fairways, anchorage, traffic separation,
 * recommended routes, restricted areas, caution areas, routing lines.
 */
import type { LayerSpecification } from "maplibre-gl";
import type { StyleContext } from "../style-context";

/** Regulatory overlay fills and outlines (always built). */
export function getNavigationOverlayLayers(
  ctx: StyleContext,
): LayerSpecification[] {
  return [
    {
      id: "s57-fairwy",
      type: "fill",
      source: ctx.sourceId,
      "source-layer": "FAIRWY",
      paint: {
        "fill-color": ctx.colour("CHWHT"),
        "fill-opacity": 0,
      },
    },
    {
      id: "s57-fairwy-outline",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "FAIRWY",
      paint: {
        "line-color": ctx.colour("APTS1"),
        "line-width": 0.8,
        "line-dasharray": [6, 4],
      },
    },
    {
      id: "s57-achare",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "ACHARE",
      paint: {
        "line-color": ctx.colour("RESBL"),
        "line-width": 1,
        "line-dasharray": [4, 3],
        "line-opacity": 0.6,
      },
    },
    {
      id: "s57-tsslpt",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "TSSLPT",
      paint: {
        "line-color": ctx.colour("TRFCD"),
        "line-width": 1,
        "line-dasharray": [6, 3],
        "line-opacity": 0.6,
      },
    },
    {
      id: "s57-resare",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "RESARE",
      paint: {
        "line-color": ctx.colour("CHMGD"),
        "line-width": 1,
        "line-dasharray": [4, 2],
        "line-opacity": 0.5,
      },
    },
    {
      id: "s57-ctnare",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "CTNARE",
      paint: {
        "line-color": ctx.colour("CHMGF"),
        "line-width": 1,
        "line-dasharray": [4, 2],
        "line-opacity": 0.5,
      },
    },
  ];
}

/** STANDARD-category routing/regulatory lines (conditionally built). */
export function getNavigationRoutingLayers(
  ctx: StyleContext,
): LayerSpecification[] {
  return [
    {
      id: "s57-navlne",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "NAVLNE",
      paint: {
        "line-color": ctx.colour("CHGRD"),
        "line-width": 1,
        "line-dasharray": [6, 3],
      },
    },
    {
      id: "s57-rectrc",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "RECTRC",
      paint: {
        "line-color": ctx.colour("TRFCD"),
        "line-width": 1.2,
        "line-dasharray": [8, 3, 2, 3],
      },
    },
    {
      id: "s57-dwrtcl",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "DWRTCL",
      paint: {
        "line-color": ctx.colour("TRFCD"),
        "line-width": 1,
        "line-dasharray": [6, 3],
      },
    },
    {
      id: "s57-tssbnd",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "TSSBND",
      paint: {
        "line-color": ctx.colour("TRFCD"),
        "line-width": 1.5,
      },
    },
    {
      id: "s57-tsezne",
      type: "fill" as const,
      source: ctx.sourceId,
      "source-layer": "TSEZNE",
      paint: {
        "fill-color": ctx.colour("TRFCD"),
        "fill-opacity": 0.1,
      },
    },
    {
      id: "s57-tsezne-outline",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "TSEZNE",
      paint: {
        "line-color": ctx.colour("TRFCD"),
        "line-width": 1,
      },
    },
    {
      id: "s57-twrtpt",
      type: "fill" as const,
      source: ctx.sourceId,
      "source-layer": "TWRTPT",
      paint: {
        "fill-color": ctx.colour("TRFCD"),
        "fill-opacity": 0.08,
      },
    },
    {
      id: "s57-twrtpt-outline",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "TWRTPT",
      paint: {
        "line-color": ctx.colour("TRFCD"),
        "line-width": 1,
        "line-dasharray": [4, 3],
      },
    },
    {
      id: "s57-achbrt",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "ACHBRT",
      paint: {
        "line-color": ctx.colour("RESBL"),
        "line-width": 1,
        "line-dasharray": [4, 3],
        "line-opacity": 0.6,
      },
    },
  ];
}
