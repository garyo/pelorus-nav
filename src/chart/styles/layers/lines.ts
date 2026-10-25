/**
 * Line layer definitions: depth contours, coastline, shoreline constructions,
 * bridges, cables, pipelines.
 */
import type {
  ExpressionSpecification,
  LayerSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import { depthUnitLabel, heightUnit } from "../../../settings";
import { listAttrContains } from "../list-attr";
import type { StyleContext } from "../style-context";
import {
  chartHeightText,
  chartValueText,
  SCALE_SORT_KEY,
  scaledIconSize,
  scaledTextSize,
  VARIABLE_ANCHOR_LAYOUT,
} from "../style-context";

/**
 * VALDCO in the user's depth unit with its suffix, truncated like every
 * other charted depth: NOAA's 6 ft contour (stored as 1.8 m) reads "5ft".
 * VALDCO may be missing — show nothing in that case.
 */
function depthContourLabel(ctx: StyleContext): ExpressionSpecification {
  const suffix =
    ctx.depthUnit === "meters" ? "" : depthUnitLabel(ctx.depthUnit);
  return [
    "case",
    ["has", "VALDCO"],
    ["concat", chartValueText("VALDCO", ctx.depthUnit), suffix],
    "",
  ];
}

/** A clearance in tenths, like `formatChartClearance` (settings.ts). */
function clearanceText(
  prop: string,
  ctx: StyleContext,
): ExpressionSpecification {
  return chartHeightText(prop, ctx.depthUnit, 1);
}

/** Overhead cable/pipe clearance: safe clearance (VERCSA) when encoded. */
function overheadClearanceText(ctx: StyleContext): ExpressionSpecification {
  return [
    "case",
    ["has", "VERCSA"],
    ["concat", "sf clr ", clearanceText("VERCSA", ctx)],
    ["concat", "clr ", clearanceText("VERCLR", ctx)],
  ];
}

/**
 * Shoreline-construction line width by CATSLC: breakwater (1) and seawall (3)
 * are heaviest; everything else (wharf/quay, jetty, groin, …) was previously
 * a near-invisible 1 px — bumped so structures like a submerged breakwater
 * actually read on the chart.
 */
const SLCONS_WIDTH = [
  "match",
  ["coalesce", ["get", "CATSLC"], 0],
  1,
  2.5, // breakwater
  3,
  2.5, // seawall
  1.6,
] as unknown as ExpressionSpecification;

/** WATLEV codes drawn dashed (submerged / covers-and-uncovers), per S-52. */
const SLCONS_SUBMERGED = [3, 4];

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
      id: "s57-depcnt-safety",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "DEPCNT",
      filter: ["==", ["get", "VALDCO"], -1], // placeholder — updated at runtime by SafetyContour
      layout: { "line-sort-key": SCALE_SORT_KEY },
      paint: {
        "line-color": ctx.colour("DEPSC"),
        "line-width": 1.5,
      },
    },
    {
      id: "s57-depcnt-label",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "DEPCNT",
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 100,
        "text-field": depthContourLabel(ctx),
        "text-size": scaledTextSize(11, ctx),
        "text-font": ["Noto Sans Regular"],
        "text-anchor": "center",
        "text-keep-upright": true,
        "text-max-angle": 30,
      },
      paint: {
        "text-color": ctx.colour("CHGRD"),
        "text-halo-color": ctx.colour("DEPMD"),
        "text-halo-width": 1.5,
      },
    },
    // Scale boundaries (S-52 SCLBDY51): where the chart cell on show changes
    // compilation scale. Depth shading can jump there, as the cells on each
    // side carry different depth contours. Built by the tile compositor
    // (layer SCLBDY), not an S-57 class.
    {
      id: "s57-sclbdy",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "SCLBDY",
      paint: {
        "line-color": ctx.colour("CHGRD"),
        "line-width": 1.2,
        "line-dasharray": [8, 2, 2, 2],
      },
    },
    {
      id: "s57-sclbdy-label",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "SCLBDY",
      layout: {
        "symbol-placement": "line",
        // An opt-in reference label early in the style: competing for space
        // it would lose to nearly every label (and lines are cut per tile,
        // so wider spacing finds no anchor). It overlaps instead, never
        // displaces anything, and draws beneath the later labels.
        "symbol-spacing": 200,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "text-field": [
          "concat",
          "1:",
          ["number-format", ["get", "CSCL_DETAILED"], { locale: "en-US" }],
          " | 1:",
          ["number-format", ["get", "CSCL_COARSE"], { locale: "en-US" }],
        ],
        "text-size": scaledTextSize(10, ctx),
        "text-font": ["Noto Sans Regular"],
        "text-keep-upright": true,
        "text-max-angle": 30,
        "text-offset": [0, -0.8],
      },
      paint: {
        "text-color": ctx.colour("CHGRD"),
        "text-halo-color": ctx.colour("DEPMD"),
        "text-halo-width": 1.5,
      },
    },
    {
      id: "s57-slcons",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "SLCONS",
      // Above-water structures: solid line. Submerged / intertidal ones are
      // drawn dashed by s57-slcons-submerged below.
      filter: [
        "match",
        ["coalesce", ["get", "WATLEV"], 0],
        SLCONS_SUBMERGED,
        false,
        true,
      ],
      layout: { "line-sort-key": SCALE_SORT_KEY },
      paint: {
        "line-color": ctx.colour("CHGRF"),
        "line-width": SLCONS_WIDTH,
      },
    },
    {
      id: "s57-slcons-submerged",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "SLCONS",
      // Submerged or covers-and-uncovers shoreline construction (e.g. a
      // submerged breakwater, WATLEV 3/4): dashed, per S-52 portrayal.
      filter: [
        "match",
        ["coalesce", ["get", "WATLEV"], 0],
        SLCONS_SUBMERGED,
        true,
        false,
      ],
      layout: { "line-sort-key": SCALE_SORT_KEY },
      paint: {
        "line-color": ctx.colour("CHGRF"),
        "line-width": SLCONS_WIDTH,
        "line-dasharray": [3, 2] as number[],
      },
    },
    {
      // Narrow watercourses, which the ENC carries as line geometry rather
      // than an area (s57-rivers fills the wide ones). A step darker down the
      // water ramp than that fill, so a thin line still reads where it runs
      // over land.
      id: "s57-rivers-line",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "RIVERS",
      filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-sort-key": SCALE_SORT_KEY },
      paint: {
        "line-color": ctx.colour("DEPVS"),
        "line-width": 2,
      },
    },
    {
      // Floating docks. Marina finger piers come through as lines, not areas
      // — the fill layer (s57-ponton) only ever catches the handful encoded
      // as polygons, whose rings this draws as an outline.
      id: "s57-ponton-line",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "PONTON",
      layout: { "line-sort-key": SCALE_SORT_KEY },
      paint: {
        "line-color": ctx.colour("CHGRF"),
        "line-width": 1.6,
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
    // Opening bridge symbol — SY(BRIDGE01) concentric circles
    // S-57 CATBRG codes for bridges that open:
    //   2=opening, 3=swing, 4=lifting, 5=bascule, 7=draw
    // (9 is a footbridge — fixed, no symbol)
    {
      id: "s57-bridge-opening",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BRIDGE",
      minzoom: ctx.detailMinzoom(12),
      filter: [
        "any",
        ...[2, 3, 4, 5, 7].map((v) => listAttrContains("CATBRG", v)),
      ] as unknown as ExpressionSpecification,
      layout: {
        "icon-image": ctx.icon("bridge-symbol"),
        "icon-size": scaledIconSize(0.7, ctx),
        "icon-allow-overlap": true,
      },
      paint: {},
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
    // Overhead pipeline — PIPOHD (same style as CBLOHD)
    {
      id: "s57-pipohd",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "PIPOHD",
      paint: {
        "line-color": ctx.colour("OUTLW"),
        "line-width": 1.2,
        "line-dasharray": [5, 3],
      },
    },
    // Sloping ground / cliff — SLOGRD
    {
      id: "s57-slogrd",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "SLOGRD",
      paint: {
        "line-color": ctx.colour("CHBRN"),
        "line-width": 1.5,
      },
    },
  ];

  return layers;
}

/**
 * Vertical clearance labels for bridges (D23) and overhead cables and pipes
 * (D26–D27). Built separately from their lines so the style can place them
 * late: they are safety information, and placed with the lines they lost
 * every collision to soundings, sea-area names and the piers' own labels.
 */
export function getClearanceLabelLayers(
  ctx: StyleContext,
): LayerSpecification[] {
  const hasBridgeClr = [
    "any",
    ["has", "VERCLR"],
    ["has", "VERCCL"],
    ["has", "VERCOP"],
  ] as unknown as ExpressionSpecification;
  const bridgeText: ExpressionSpecification = [
    "case",
    ["has", "VERCOP"],
    [
      "concat",
      "clr ",
      chartValueText("VERCCL", heightUnit(ctx.depthUnit), 1),
      "/",
      clearanceText("VERCOP", ctx),
    ],
    ["has", "VERCLR"],
    ["concat", "clr ", clearanceText("VERCLR", ctx)],
    ["has", "VERCCL"],
    ["concat", "clr ", clearanceText("VERCCL", ctx)],
    "",
  ];
  const text = {
    "text-size": scaledTextSize(10, ctx),
    "text-font": ["Noto Sans Regular"],
    "text-allow-overlap": false,
  };
  // S-52 draws every clearance in CHBLK, to a tenth (TE 'clr %4.1lf').
  const paint = {
    "text-color": ctx.colour("CHBLK"),
    "text-halo-color": ctx.colour("CHWHT"),
    "text-halo-width": 1,
  };
  return [
    {
      id: "s57-bridge-label",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BRIDGE",
      minzoom: ctx.detailMinzoom(13),
      filter: [
        "all",
        hasBridgeClr,
        ["!=", ["geometry-type"], "LineString"],
      ] as unknown as ExpressionSpecification,
      // A span sits between piers, buoys and racons; any side of it will do.
      layout: { ...text, ...VARIABLE_ANCHOR_LAYOUT, "text-field": bridgeText },
      paint,
    },
    {
      id: "s57-bridge-label-line",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BRIDGE",
      minzoom: ctx.detailMinzoom(13),
      filter: [
        "all",
        hasBridgeClr,
        ["==", ["geometry-type"], "LineString"],
      ] as unknown as ExpressionSpecification,
      layout: {
        ...text,
        "symbol-placement": "line-center",
        "text-field": bridgeText,
      },
      paint,
    },
    ...(["CBLOHD", "PIPOHD"] as const).map(
      (sourceLayer): LayerSpecification => ({
        id: `s57-${sourceLayer.toLowerCase()}-label`,
        type: "symbol",
        source: ctx.sourceId,
        "source-layer": sourceLayer,
        minzoom: ctx.detailMinzoom(14),
        filter: ["any", ["has", "VERCLR"], ["has", "VERCSA"]],
        layout: {
          ...text,
          "symbol-placement": "line-center",
          "text-field": overheadClearanceText(ctx),
        },
        paint,
      }),
    ),
  ];
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
      minzoom: ctx.detailMinzoom(12),
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
      minzoom: ctx.detailMinzoom(12),
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
      minzoom: ctx.detailMinzoom(12),
      paint: {
        "line-color": ctx.colour("ISDNG"),
        "line-width": 1,
        "line-dasharray": [4, 3] as number[],
      },
    },
  ];
}
