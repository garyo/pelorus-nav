/**
 * Text/label layer definitions: place names, feature labels,
 * landmarks (icon + text), berth names.
 *
 * Note: LNDMRK is a symbol layer with both icon and text, but lives
 * here because it is interleaved with text-only labels in the draw order.
 */
import type {
  ExpressionSpecification,
  LayerSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import { depthUnitLabel } from "../../../settings";
import type { StyleContext } from "../style-context";
import {
  SORT_KEY_AREA,
  SORT_KEY_FACILITY,
  SORT_KEY_LANDMARK,
  SORT_KEY_NAMED_LAND,
  scaledTextSize,
  VARIABLE_ANCHOR_LAYOUT,
} from "../style-context";

/** Build a MapLibre expression for elevation text: converts ELEVAT to depth unit with suffix. */
function elevationTextField(ctx: StyleContext): ExpressionSpecification {
  const suffix = ` ${depthUnitLabel(ctx.depthUnit)}`;
  const namePrefix = [
    "case",
    ["has", "OBJNAM"],
    ["concat", ["get", "OBJNAM"], "\n"],
    "",
  ];

  if (ctx.depthUnit === "meters") {
    return [
      "concat",
      namePrefix,
      ["round", ["get", "ELEVAT"]],
      suffix,
    ] as unknown as ExpressionSpecification;
  }

  const factor = ctx.depthUnit === "feet" ? 3.28084 : 0.546807; /* fathoms */
  return [
    "concat",
    namePrefix,
    ["round", ["*", ["get", "ELEVAT"], factor]],
    suffix,
  ] as unknown as ExpressionSpecification;
}

export function getTextLayers(ctx: StyleContext): LayerSpecification[] {
  // Within this list, LATER entries place first and so win collisions.
  // Order is low → high priority: sea/urban areas → named land → built
  // structures → landmarks. symbol-sort-key mirrors this ordering for
  // cross-module placement (buoys/beacons in getBuoyBeaconLayers still
  // beat everything here because that array is appended after us).
  return [
    // ── Lowest priority: big area labels ─────────────────────────────
    {
      id: "s57-seaare-label",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "SEAARE",
      minzoom: ctx.detailMinzoom(10),
      filter: ["has", "OBJNAM"],
      layout: {
        ...VARIABLE_ANCHOR_LAYOUT,
        "symbol-sort-key": SORT_KEY_AREA,
        "text-field": ["get", "OBJNAM"],
        "text-size": scaledTextSize(
          [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            10,
            14,
            12,
          ] as unknown as ExpressionSpecification,
          ctx,
        ),
        "text-font": ["Noto Sans Italic"],
        "text-allow-overlap": false,
        "text-padding": 10,
      },
      paint: {
        "text-color": ctx.colour("BKAJ1"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1.5,
      },
    },
    // Built-up areas (cities, towns)
    {
      id: "s57-buaare-label",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BUAARE",
      minzoom: ctx.detailMinzoom(9),
      filter: ["has", "OBJNAM"],
      layout: {
        ...VARIABLE_ANCHOR_LAYOUT,
        "symbol-sort-key": SORT_KEY_AREA,
        "text-field": ["get", "OBJNAM"],
        "text-size": scaledTextSize(
          [
            "interpolate",
            ["linear"],
            ["zoom"],
            9,
            12,
            14,
            16,
          ] as unknown as ExpressionSpecification,
          ctx,
        ),
        "text-font": ["Noto Sans Bold"],
        "text-allow-overlap": false,
        "text-padding": 10,
      },
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("LANDA"),
        "text-halo-width": 2,
      },
    },
    {
      id: "s57-lndare-label",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "LNDARE",
      minzoom: ctx.detailMinzoom(11),
      filter: ["has", "OBJNAM"],
      layout: {
        ...VARIABLE_ANCHOR_LAYOUT,
        "symbol-sort-key": SORT_KEY_NAMED_LAND,
        "text-field": ["get", "OBJNAM"],
        "text-size": scaledTextSize(
          [
            "interpolate",
            ["linear"],
            ["zoom"],
            11,
            10,
            14,
            13,
          ] as unknown as ExpressionSpecification,
          ctx,
        ),
        "text-font": ["Noto Sans Italic"],
        "text-allow-overlap": false,
        "text-padding": 10,
      },
      paint: {
        "text-color": ctx.colour("NINFO"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1.5,
      },
    },
    // Land regions (named capes, points, peninsulas)
    {
      id: "s57-lndrgn-label",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "LNDRGN",
      minzoom: ctx.detailMinzoom(11),
      filter: ["has", "OBJNAM"],
      layout: {
        ...VARIABLE_ANCHOR_LAYOUT,
        "symbol-sort-key": SORT_KEY_NAMED_LAND,
        "text-field": ["get", "OBJNAM"],
        "text-size": scaledTextSize(
          [
            "interpolate",
            ["linear"],
            ["zoom"],
            11,
            10,
            14,
            13,
          ] as unknown as ExpressionSpecification,
          ctx,
        ),
        "text-font": ["Noto Sans Italic"],
        "text-allow-overlap": false,
        "text-padding": 10,
      },
      paint: {
        "text-color": ctx.colour("NINFO"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1.5,
      },
    },
    // Land elevations (hill/peak heights)
    {
      id: "s57-lndelv-label",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "LNDELV",
      minzoom: ctx.detailMinzoom(12),
      layout: {
        "symbol-sort-key": SORT_KEY_NAMED_LAND,
        "icon-image": "POSGEN04",
        "icon-size": 1.0,
        "icon-allow-overlap": true,
        "text-field": elevationTextField(ctx),
        "text-size": scaledTextSize(10, ctx),
        "text-font": ["Noto Sans Regular"],
        "text-allow-overlap": false,
        "text-optional": true,
        "text-anchor": "top" as const,
        "text-offset": [0, 0.8] as [number, number],
        "text-padding": 5,
      },
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1.5,
      },
    },
    {
      id: "s57-berths-label",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BERTHS",
      minzoom: ctx.detailMinzoom(13),
      filter: ["has", "OBJNAM"],
      layout: {
        ...VARIABLE_ANCHOR_LAYOUT,
        "symbol-sort-key": SORT_KEY_FACILITY,
        "text-field": ["get", "OBJNAM"],
        "text-size": scaledTextSize(10, ctx),
        "text-allow-overlap": false,
        "text-padding": 5,
      },
      paint: {
        "text-color": ctx.colour("CHGRF"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1,
      },
    },
    // Shoreline construction labels (wharves, piers)
    {
      id: "s57-slcons-label",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "SLCONS",
      minzoom: ctx.detailMinzoom(13),
      filter: ["has", "OBJNAM"],
      layout: {
        "symbol-placement": "line",
        "text-field": ["get", "OBJNAM"],
        "text-size": scaledTextSize(10, ctx),
        "text-allow-overlap": false,
        "text-padding": 5,
      },
      paint: {
        "text-color": ctx.colour("CHGRF"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1,
      },
    },
    // Building labels
    {
      id: "s57-buisgl-label",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BUISGL",
      minzoom: ctx.detailMinzoom(14),
      filter: ["has", "OBJNAM"],
      layout: {
        ...VARIABLE_ANCHOR_LAYOUT,
        "symbol-sort-key": SORT_KEY_FACILITY,
        "text-field": ["get", "OBJNAM"],
        "text-size": scaledTextSize(10, ctx),
        "text-allow-overlap": false,
        "text-padding": 5,
      },
      paint: {
        "text-color": ctx.colour("CHGRF"),
        "text-halo-color": ctx.colour("LANDA"),
        "text-halo-width": 1,
      },
    },
    // Building FUNCTN-based icons (church, temple, mosque)
    {
      id: "s57-buisgl-functn",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BUISGL",
      minzoom: ctx.detailMinzoom(13),
      filter: [
        "match",
        ["to-number", ["coalesce", ["get", "FUNCTN"], "0"]],
        [
          20, // church
          21, // chapel
          22, // temple
          23, // pagoda
          24, // Shinto shrine
          25, // Buddhist temple
          26, // mosque
        ],
        true,
        false,
      ] as unknown as ExpressionSpecification,
      layout: {
        "icon-image": [
          "match",
          ["to-number", ["get", "FUNCTN"]],
          26,
          ctx.icon("landmark-mosque-conspic"),
          22,
          ctx.icon("landmark-temple"),
          23,
          ctx.icon("landmark-temple"),
          24,
          ctx.icon("landmark-temple"),
          25,
          ctx.icon("landmark-temple"),
          // 20 (church), 21 (chapel) → church symbol
          ctx.icon("landmark-church-conspic"),
        ] as unknown as ExpressionSpecification,
        "icon-size": 0.6,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    // Small craft facilities (marinas, yacht clubs)
    {
      id: "s57-smcfac-label",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "SMCFAC",
      minzoom: ctx.detailMinzoom(12),
      filter: ["has", "OBJNAM"],
      layout: {
        ...VARIABLE_ANCHOR_LAYOUT,
        "symbol-sort-key": SORT_KEY_FACILITY,
        "text-field": ["get", "OBJNAM"],
        "text-size": scaledTextSize(10, ctx),
        "text-allow-overlap": false,
        "text-padding": 5,
      },
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1,
      },
    },
    // ── Highest priority within this block: landmarks ──────────────
    // Placed last so lighthouses, towers, monuments etc win collisions
    // against the area labels declared earlier.
    (() => {
      const lndmrk = ctx.layerExprs("LNDMRK");
      return {
        id: "s57-lndmrk",
        type: "symbol" as const,
        source: ctx.sourceId,
        "source-layer": "LNDMRK",
        minzoom: ctx.detailMinzoom(12),
        layout: {
          ...VARIABLE_ANCHOR_LAYOUT,
          "symbol-sort-key": SORT_KEY_LANDMARK,
          // LNDMRK has a sizeable icon; push labels a bit further out.
          "text-radial-offset": 1.8,
          "icon-image": lndmrk.iconExpr,
          "icon-size": 0.6 * ctx.iconSizeScale,
          "icon-allow-overlap": true,
          ...(lndmrk.offsetExpr ? { "icon-offset": lndmrk.offsetExpr } : {}),
          "text-field": ["get", "OBJNAM"] as unknown as ExpressionSpecification,
          "text-size": scaledTextSize(11, ctx),
          "text-allow-overlap": false,
          "text-optional": true,
        },
        paint: {
          "text-color": ctx.colour("CHBLK"),
          "text-halo-color": ctx.colour("NAIDH"),
          "text-halo-width": 1.5,
        },
      };
    })(),
  ];
}
