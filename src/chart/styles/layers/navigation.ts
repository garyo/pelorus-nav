/**
 * Navigation layer definitions: fairways, anchorage, traffic separation,
 * recommended routes, restricted areas, caution areas, routing lines.
 */
import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";
import type { StyleContext } from "../style-context";
import { scaledTextSize } from "../style-context";

/** Regulatory overlay fills and outlines (always built). */
export function getNavigationOverlayLayers(
  ctx: StyleContext,
): LayerSpecification[] {
  return [
    // Precautionary Area — similar to caution area
    {
      id: "s57-prcare",
      type: "fill",
      source: ctx.sourceId,
      "source-layer": "PRCARE",
      paint: {
        "fill-color": ctx.colour("CHMGF"),
        "fill-opacity": 0.08,
      },
    },
    {
      id: "s57-prcare-outline",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "PRCARE",
      paint: {
        "line-color": ctx.colour("CHMGF"),
        "line-width": 1,
        "line-dasharray": [4, 2],
        "line-opacity": 0.5,
      },
    },
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
        "line-color": ctx.colour("CHMGD"),
        "line-width": 1,
        "line-dasharray": [4, 3],
        "line-opacity": 0.6,
      },
    },
    // Anchorage area anchor symbol at centroid
    {
      id: "s57-achare-symbol",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "ACHARE",
      minzoom: ctx.detailMinzoom(10),
      layout: {
        "icon-image": "ACHARE02",
        "icon-size": 0.8,
        "icon-allow-overlap": true,
        "text-field": ["get", "OBJNAM"] as unknown as ExpressionSpecification,
        "text-size": scaledTextSize(11, ctx),
        "text-font": ["Noto Sans Regular"],
        "text-allow-overlap": false,
        "text-optional": true,
        "text-anchor": "top" as const,
        "text-offset": [0, 1.5] as [number, number],
      },
      paint: {
        "icon-opacity": 0.15,
        "text-color": ctx.colour("CHMGD"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1,
        "text-opacity": 0.6,
      },
    },
    // Restricted area symbol (anchoring prohibited)
    {
      id: "s57-resare-symbol",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "RESARE",
      minzoom: ctx.detailMinzoom(10),
      filter: ["in", "1", ["get", "RESTRN"]],
      layout: {
        "icon-image": "ACHRES51",
        "icon-size": 0.5,
        "icon-allow-overlap": true,
      },
      paint: {
        "icon-opacity": 0.4,
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
    // TSS traffic direction arrow — SY(TSSLPT51) at lane centroid,
    // rotated by ORIENT attribute. Only for directed lanes (TRAFIC 1–3).
    {
      id: "s57-tsslpt-arrow",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "TSSLPT",
      minzoom: ctx.detailMinzoom(8),
      filter: ["has", "ORIENT"] as unknown as ExpressionSpecification,
      layout: {
        "icon-image": ctx.icon("tss-arrow"),
        "icon-size": 0.7,
        "icon-rotate": [
          "to-number",
          ["coalesce", ["get", "ORIENT"], 0],
          0,
        ] as unknown as ExpressionSpecification,
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
      },
      paint: {
        "icon-opacity": 0.6,
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
    // Marine farm / aquaculture — MARCUL polygon outline + point symbol
    {
      id: "s57-marcul",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "MARCUL",
      minzoom: 10,
      filter: [
        "==",
        ["geometry-type"],
        "Polygon",
      ] as unknown as ExpressionSpecification,
      paint: {
        "line-color": ctx.colour("CHGRD"),
        "line-width": 1,
        "line-dasharray": [4, 2],
        "line-opacity": 0.6,
      },
    },
    {
      id: "s57-marcul-symbol",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "MARCUL",
      minzoom: ctx.detailMinzoom(11),
      layout: {
        "icon-image": "MARCUL02",
        "icon-size": 0.7,
        "icon-allow-overlap": true,
      },
      paint: {
        "icon-opacity": 0.7,
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
    // CTNARE — S-52 SY(CTNARE51) centered caution symbol
    {
      id: "s57-ctnare-symbol",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "CTNARE",
      minzoom: 8,
      layout: {
        "icon-image": ctx.icon("caution-area"),
        "icon-size": 0.7,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    // Military practice area — MIPARE
    {
      id: "s57-mipare",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "MIPARE",
      paint: {
        "line-color": ctx.colour("CHMGD"),
        "line-width": 1,
        "line-dasharray": [4, 2],
        "line-opacity": 0.5,
      },
    },
    // Offshore production area (wind farms, etc.) — OSPARE
    {
      id: "s57-ospare",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "OSPARE",
      paint: {
        "line-color": ctx.colour("CHMGD"),
        "line-width": 1,
        "line-dasharray": [4, 2],
        "line-opacity": 0.5,
      },
    },
    // Territorial sea area boundary — TESARE
    {
      id: "s57-tesare",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "TESARE",
      paint: {
        "line-color": ctx.colour("CHGRD"),
        "line-width": 1,
        "line-dasharray": [6, 3],
        "line-opacity": 0.4,
      },
    },
    // Exclusive economic zone boundary — EXEZNE
    {
      id: "s57-exezne",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "EXEZNE",
      paint: {
        "line-color": ctx.colour("CHGRD"),
        "line-width": 1,
        "line-dasharray": [6, 3],
        "line-opacity": 0.4,
      },
    },
    // Inshore traffic zone — ISTZNE
    {
      id: "s57-istzne",
      type: "fill",
      source: ctx.sourceId,
      "source-layer": "ISTZNE",
      paint: {
        "fill-color": ctx.colour("TRFCD"),
        "fill-opacity": 0.08,
      },
    },
    {
      id: "s57-istzne-outline",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "ISTZNE",
      paint: {
        "line-color": ctx.colour("TRFCD"),
        "line-width": 1,
        "line-dasharray": [4, 2],
      },
    },
    // TSS roundabout — TSSRON
    {
      id: "s57-tssron",
      type: "fill",
      source: ctx.sourceId,
      "source-layer": "TSSRON",
      paint: {
        "fill-color": ctx.colour("TRFCD"),
        "fill-opacity": 0.08,
      },
    },
    {
      id: "s57-tssron-outline",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "TSSRON",
      paint: {
        "line-color": ctx.colour("TRFCD"),
        "line-width": 1.5,
      },
    },
    // Ferry route — FERYRT
    {
      id: "s57-feryrt",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "FERYRT",
      paint: {
        "line-color": ctx.colour("CHGRD"),
        "line-width": 1,
        "line-dasharray": [6, 3],
      },
    },
    // Swept area — SWPARE (I24)
    {
      id: "s57-swpare",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "SWPARE",
      paint: {
        "line-color": ctx.colour("DEPSC"),
        "line-width": 1.5,
        "line-dasharray": [6, 2],
      },
    },
    // Swept area depth label
    {
      id: "s57-swpare-label",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "SWPARE",
      filter: ["has", "DRVAL1"],
      layout: {
        "text-field": [
          "concat",
          "Sw ",
          ["to-string", ["get", "DRVAL1"]],
          "m",
        ] as unknown as ExpressionSpecification,
        "text-size": scaledTextSize(10, ctx),
        "text-font": ["Noto Sans Regular"],
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": ctx.colour("DEPSC"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1,
      },
    },
    // Overfalls / tide rips — OVFALL
    {
      id: "s57-ovfall",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "OVFALL",
      minzoom: 10,
      layout: {
        "icon-image": "WATTUR02",
        "icon-size": 0.7,
        "icon-allow-overlap": true,
      },
      paint: {},
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
    // Deep water route "DW" label (M5, M27)
    {
      id: "s57-dwrtcl-label",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "DWRTCL",
      minzoom: 10,
      layout: {
        "symbol-placement": "line-center",
        "text-field": "DW",
        "text-size": scaledTextSize(11, ctx),
        "text-font": ["Noto Sans Bold"],
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": ctx.colour("TRFCD"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1,
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
    // Anchorage berths (point symbols with "Nr" labels)
    {
      id: "s57-achbrt",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "ACHBRT",
      minzoom: ctx.detailMinzoom(11),
      layout: {
        "icon-image": "ACHBRT07",
        "icon-size": 0.7,
        "icon-allow-overlap": true,
        "text-field": [
          "concat",
          "Nr ",
          ["get", "OBJNAM"],
        ] as unknown as ExpressionSpecification,
        "text-size": scaledTextSize(10, ctx),
        "text-font": ["Noto Sans Regular"],
        "text-allow-overlap": true,
        "text-anchor": "top" as const,
        "text-offset": [0, 1.2] as [number, number],
      },
      paint: {
        "icon-opacity": 0.5,
        "text-color": ctx.colour("CHMGD"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1,
      },
    },
  ];
}
