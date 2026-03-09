/**
 * Point/symbol layer definitions: soundings, buoys, beacons, lights,
 * landmarks, wrecks, underwater rocks, obstructions, platforms, pilings,
 * fog signals, mooring facilities.
 */
import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";
import type { StyleContext } from "../style-context";
import { depthTextField, LABEL_EXPR } from "../style-context";

/** Soundings, lights, buoys, and beacons (before the label section). */
export function getNavAidLayers(ctx: StyleContext): LayerSpecification[] {
  return [
    // Soundings — depth label only
    {
      id: "s57-soundg",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "SOUNDG",
      layout: {
        "text-field": depthTextField(ctx.depthUnit),
        "text-size": 10,
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": ctx.colour("SNDG1"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1,
      },
    },

    // Lights — glow ring underneath, then icon on top
    {
      id: "s57-lights-glow",
      type: "circle",
      source: ctx.sourceId,
      "source-layer": "LIGHTS",
      paint: {
        "circle-radius": 12,
        "circle-color": ctx.colour("LITYW"),
        "circle-blur": 0.6,
        "circle-stroke-width": 2,
        "circle-stroke-color": ctx.colour("LITYW"),
        "circle-opacity": 0.25,
        "circle-stroke-opacity": 0.5,
      },
    },
    {
      id: "s57-lights",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "LIGHTS",
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": 0.7,
        "icon-allow-overlap": true,
        "icon-optional": true,
        "text-field": ["get", "LABEL"],
        "text-size": 10,
        "text-offset": [0, -1.5],
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": ctx.colour("SNDG2"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1.5,
      },
    },

    // Lateral buoys
    {
      id: "s57-boylat",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BOYLAT",
      minzoom: 8,
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": 0.75,
        "icon-allow-overlap": true,
        "text-field": LABEL_EXPR,
        "text-size": 11,
        "text-offset": [0, 1.5],
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1.5,
      },
    },

    // Cardinal buoys
    {
      id: "s57-boycar",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BOYCAR",
      minzoom: 8,
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": 0.75,
        "icon-allow-overlap": true,
        "text-field": LABEL_EXPR,
        "text-size": 11,
        "text-offset": [0, 1.5],
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1.5,
      },
    },

    // Safe water buoys
    {
      id: "s57-boysaw",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BOYSAW",
      minzoom: 8,
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": 0.75,
        "icon-allow-overlap": true,
        "text-field": LABEL_EXPR,
        "text-size": 11,
        "text-offset": [0, 1.5],
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1.5,
      },
    },

    // Special purpose buoys
    {
      id: "s57-boyspp",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BOYSPP",
      minzoom: 8,
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": 0.7,
        "icon-allow-overlap": true,
        "text-field": LABEL_EXPR,
        "text-size": 11,
        "text-offset": [0, 1.5],
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1.5,
      },
    },

    // Isolated danger buoys
    {
      id: "s57-boyisd",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BOYISD",
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": 0.75,
        "icon-allow-overlap": true,
        "text-field": LABEL_EXPR,
        "text-size": 11,
        "text-offset": [0, 1.5],
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1.5,
      },
    },

    // Lateral beacons
    {
      id: "s57-bcnlat",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BCNLAT",
      minzoom: 8,
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": 0.7,
        "icon-allow-overlap": true,
        "text-field": LABEL_EXPR,
        "text-size": 11,
        "text-offset": [0, 1.5],
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1.5,
      },
    },

    // Cardinal beacons
    {
      id: "s57-bcncar",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BCNCAR",
      minzoom: 8,
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": 0.7,
        "icon-allow-overlap": true,
        "text-field": LABEL_EXPR,
        "text-size": 11,
        "text-offset": [0, 1.5],
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1.5,
      },
    },
  ];
}

/** Hazard layers: wrecks, obstructions, underwater rocks. */
export function getHazardLayers(ctx: StyleContext): LayerSpecification[] {
  return [
    // Wrecks
    {
      id: "s57-wrecks",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "WRECKS",
      minzoom: 10,
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          0.45,
          13,
          0.75,
        ] as unknown as ExpressionSpecification,
        "icon-allow-overlap": [
          "step",
          ["zoom"],
          false,
          13,
          true,
        ] as unknown as ExpressionSpecification,
        "icon-padding": 2,
        "symbol-sort-key": [
          "case",
          ["==", ["get", "CATWRK"], 2],
          0,
          1,
        ] as unknown as ExpressionSpecification,
      },
      paint: {},
    },
    // Obstructions — polygon fill (foul areas)
    {
      id: "s57-obstrn-area",
      type: "fill",
      source: ctx.sourceId,
      "source-layer": "OBSTRN",
      minzoom: 11,
      filter: [
        "==",
        ["geometry-type"],
        "Polygon",
      ] as unknown as ExpressionSpecification,
      paint: {
        "fill-color": ctx.colour("DEPVS"),
        "fill-opacity": 0.2,
      },
    },
    // Obstructions — line (piling rows, submerged walls, etc.)
    {
      id: "s57-obstrn-line",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "OBSTRN",
      minzoom: 11,
      filter: [
        "==",
        ["geometry-type"],
        "LineString",
      ] as unknown as ExpressionSpecification,
      paint: {
        "line-color": ctx.colour("CHBLK"),
        "line-width": 1.5,
        "line-dasharray": [2, 2] as number[],
      },
    },
    // Obstructions — point symbols
    {
      id: "s57-obstrn",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "OBSTRN",
      minzoom: 10,
      filter: [
        "==",
        ["geometry-type"],
        "Point",
      ] as unknown as ExpressionSpecification,
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          0.25,
          13,
          0.35,
        ] as unknown as ExpressionSpecification,
        "icon-allow-overlap": [
          "step",
          ["zoom"],
          false,
          13,
          true,
        ] as unknown as ExpressionSpecification,
        "icon-padding": 2,
      },
      paint: {},
    },
    // Underwater rocks
    {
      id: "s57-uwtroc",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "UWTROC",
      minzoom: 10,
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          0.25,
          13,
          0.35,
        ] as unknown as ExpressionSpecification,
        "icon-allow-overlap": [
          "step",
          ["zoom"],
          false,
          13,
          true,
        ] as unknown as ExpressionSpecification,
        "icon-padding": 2,
      },
      paint: {},
    },
  ];
}

/** Other nav aid layers: fog signals, pilings, mooring, special beacons, seabed. */
export function getOtherNavAidLayers(ctx: StyleContext): LayerSpecification[] {
  return [
    // Fog signals
    {
      id: "s57-fogsig",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "FOGSIG",
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": 0.6,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {},
    },
    // Pilings
    {
      id: "s57-pilpnt",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "PILPNT",
      minzoom: ctx.detailMinzoom(13),
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": 0.6,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    // Mooring facilities
    {
      id: "s57-morfac",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "MORFAC",
      minzoom: ctx.detailMinzoom(13),
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": 0.5,
        "icon-allow-overlap": true,
      },
      paint: {},
    },

    // Special purpose beacons
    {
      id: "s57-bcnspp",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BCNSPP",
      minzoom: 8,
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": 0.7,
        "icon-allow-overlap": true,
        "text-field": LABEL_EXPR,
        "text-size": 11,
        "text-offset": [0, 1.5],
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1.5,
      },
    },

    // Seabed area labels
    {
      id: "s57-sbdare",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "SBDARE",
      minzoom: ctx.detailMinzoom(12),
      layout: {
        "text-field": ["get", "NATSUR"],
        "text-size": 10,
        "text-font": ["Noto Sans Italic"],
        "text-allow-overlap": false,
        "text-padding": 5,
      },
      paint: {
        "text-color": ctx.colour("CHGRD"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1,
      },
    },
  ];
}

/** OTHER-category point layers: facilities, platforms, magvar, etc. */
export function getOtherPointLayers(ctx: StyleContext): LayerSpecification[] {
  return [
    {
      id: "s57-dmpgrd",
      type: "fill" as const,
      source: ctx.sourceId,
      "source-layer": "DMPGRD",
      paint: {
        "fill-color": ctx.colour("CHMGD"),
        "fill-opacity": 0.12,
      },
    },
    {
      id: "s57-dmpgrd-outline",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "DMPGRD",
      paint: {
        "line-color": ctx.colour("CHMGD"),
        "line-width": 1,
        "line-dasharray": [4, 3] as number[],
      },
    },
    {
      id: "s57-siltnk",
      type: "fill" as const,
      source: ctx.sourceId,
      "source-layer": "SILTNK",
      minzoom: ctx.detailMinzoom(13),
      paint: {
        "fill-color": ctx.colour("CHBRN"),
        "fill-opacity": 0.3,
      },
    },
    {
      id: "s57-siltnk-outline",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "SILTNK",
      minzoom: ctx.detailMinzoom(13),
      paint: {
        "line-color": ctx.colour("CHBLK"),
        "line-width": 1,
      },
    },
    {
      id: "s57-siltnk-icon",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "SILTNK",
      minzoom: ctx.detailMinzoom(13),
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": 0.5,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    {
      id: "s57-hrbfac",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "HRBFAC",
      minzoom: ctx.detailMinzoom(13),
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": 0.6,
        "icon-allow-overlap": true,
        "text-field": ["get", "OBJNAM"] as unknown as ExpressionSpecification,
        "text-size": 10,
        "text-offset": [0, 1.5] as [number, number],
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1,
      },
    },
    {
      id: "s57-ofsplf",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "OFSPLF",
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": 0.6,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    {
      id: "s57-magvar",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "MAGVAR",
      minzoom: ctx.detailMinzoom(8),
      layout: {
        "text-field": [
          "concat",
          ["get", "VALMAG"],
          "\u00b0",
        ] as unknown as ExpressionSpecification,
        "text-size": 10,
        "text-font": ["Noto Sans Italic"],
        "text-allow-overlap": false,
        "text-padding": 20,
      },
      paint: {
        "text-color": ctx.colour("NINFO"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1,
      },
    },
  ];
}

/** OTHER-category daymarks and topmarks. */
export function getDaymarkTopmarkLayers(
  ctx: StyleContext,
): LayerSpecification[] {
  return [
    {
      id: "s57-daymar",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "DAYMAR",
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": 0.6,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    {
      id: "s57-topmar",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "TOPMAR",
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": 0.45,
        "icon-allow-overlap": true,
        "icon-offset": [0, -10] as [number, number],
      },
      paint: {},
    },
  ];
}
