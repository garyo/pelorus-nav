import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";
import {
  type DepthUnit,
  depthConversionFactor,
  depthUnitLabel,
} from "../settings";
import { buildIconExpression, ECDIS_SIMPLIFIED } from "./icon-sets";

/**
 * Nautical chart style layers for S-57 vector tiles.
 * Uses sprite-based ECDIS simplified symbology.
 *
 * Layer ordering:
 *   1. Background
 *   2. Fill layers — terrain first, then regulatory overlays
 *   3. Line layers
 *   4. Point/symbol layers
 */

/** Label expression: shows quoted LABEL if present, else empty string. */
const LABEL_EXPR = [
  "case",
  ["all", ["has", "LABEL"], ["!=", ["get", "LABEL"], ""]],
  ["concat", '"', ["get", "LABEL"], '"'],
  "",
] as unknown as ExpressionSpecification;

/** Icon expression for the current icon set. */
const ICON_EXPR = buildIconExpression(ECDIS_SIMPLIFIED, "ecdis-buoy-default");

/** Build a MapLibre expression that converts DEPTH to the given unit. */
function depthTextField(unit: DepthUnit): ExpressionSpecification {
  const factor = depthConversionFactor(unit);
  const label = depthUnitLabel(unit);
  if (unit === "meters") {
    return [
      "to-string",
      ["get", "DEPTH"],
    ] as unknown as ExpressionSpecification;
  }
  const decimals = unit === "fathoms" ? 1 : 0;
  // Round to N decimal places: floor((val * factor) * 10^d + 0.5) / 10^d
  const pow = 10 ** decimals;
  return [
    "concat",
    [
      "to-string",
      ["/", ["round", ["*", ["*", ["get", "DEPTH"], factor], pow]], pow],
    ],
    ` ${label}`,
  ] as unknown as ExpressionSpecification;
}

export function getNauticalLayers(
  sourceId: string,
  depthUnit: DepthUnit = "meters",
  detailOffset = 0,
): LayerSpecification[] {
  // Detail offset: positive shows more (lower minzoom), negative shows less
  // Only applies to non-essential layers (labels, secondary features)
  const detailMinzoom = (base: number) => Math.max(0, base - detailOffset);
  return [
    // ── Background ──────────────────────────────────────────────────────
    {
      id: "s57-background",
      type: "background",
      paint: {
        "background-color": "#d4e8f7",
      },
    },

    // ── Fill layers: terrain ────────────────────────────────────────────
    {
      id: "s57-lndare",
      type: "fill",
      source: sourceId,
      "source-layer": "LNDARE",
      paint: {
        "fill-color": "#f5e6c8",
        "fill-opacity": 1,
      },
    },
    {
      id: "s57-depare-shallow",
      type: "fill",
      source: sourceId,
      "source-layer": "DEPARE",
      filter: ["<", ["get", "DRVAL1"], 5],
      paint: {
        "fill-color": "#a8ccee",
        "fill-opacity": 0.9,
      },
    },
    {
      id: "s57-depare-medium",
      type: "fill",
      source: sourceId,
      "source-layer": "DEPARE",
      filter: [
        "all",
        [">=", ["get", "DRVAL1"], 5],
        ["<", ["get", "DRVAL1"], 20],
      ],
      paint: {
        "fill-color": "#c4ddf5",
        "fill-opacity": 0.9,
      },
    },
    {
      id: "s57-depare-deep",
      type: "fill",
      source: sourceId,
      "source-layer": "DEPARE",
      filter: [">=", ["get", "DRVAL1"], 20],
      paint: {
        "fill-color": "#d4e8f7",
        "fill-opacity": 0.9,
      },
    },
    {
      id: "s57-depare-drying",
      type: "fill",
      source: sourceId,
      "source-layer": "DEPARE",
      filter: ["<", ["get", "DRVAL1"], 0],
      paint: {
        "fill-color": "#8cbc8c",
        "fill-opacity": 0.9,
      },
    },
    {
      id: "s57-lakare",
      type: "fill",
      source: sourceId,
      "source-layer": "LAKARE",
      paint: {
        "fill-color": "#a8ccee",
        "fill-opacity": 0.8,
      },
    },
    {
      id: "s57-rivers",
      type: "fill",
      source: sourceId,
      "source-layer": "RIVERS",
      paint: {
        "fill-color": "#a8ccee",
        "fill-opacity": 0.8,
      },
    },
    {
      id: "s57-drgare",
      type: "fill",
      source: sourceId,
      "source-layer": "DRGARE",
      paint: {
        "fill-color": "#c8d8e8",
        "fill-opacity": 0.5,
      },
    },
    {
      id: "s57-drgare-outline",
      type: "line",
      source: sourceId,
      "source-layer": "DRGARE",
      paint: {
        "line-color": "#8899aa",
        "line-width": 1,
        "line-dasharray": [4, 3],
      },
    },
    {
      id: "s57-ponton",
      type: "fill",
      source: sourceId,
      "source-layer": "PONTON",
      paint: {
        "fill-color": "#cccccc",
        "fill-opacity": 0.8,
      },
    },
    {
      id: "s57-buisgl",
      type: "fill",
      source: sourceId,
      "source-layer": "BUISGL",
      paint: {
        "fill-color": "#b5926b",
        "fill-opacity": 0.7,
      },
    },
    {
      id: "s57-buisgl-outline",
      type: "line",
      source: sourceId,
      "source-layer": "BUISGL",
      paint: {
        "line-color": "#8c6d4f",
        "line-width": 0.5,
      },
    },
    {
      id: "s57-unsare",
      type: "fill",
      source: sourceId,
      "source-layer": "UNSARE",
      paint: {
        "fill-color": "#cccccc",
        "fill-opacity": 0.3,
      },
    },

    // ── Fill layers: regulatory overlays ────────────────────────────────
    {
      id: "s57-fairwy",
      type: "fill",
      source: sourceId,
      "source-layer": "FAIRWY",
      paint: {
        "fill-color": "#ffffff",
        "fill-opacity": 0,
      },
    },
    {
      id: "s57-fairwy-outline",
      type: "line",
      source: sourceId,
      "source-layer": "FAIRWY",
      paint: {
        "line-color": "#7777aa",
        "line-width": 0.8,
        "line-dasharray": [6, 4],
      },
    },
    {
      id: "s57-achare",
      type: "line",
      source: sourceId,
      "source-layer": "ACHARE",
      paint: {
        "line-color": "#9933cc",
        "line-width": 1,
        "line-dasharray": [4, 3],
        "line-opacity": 0.6,
      },
    },
    {
      id: "s57-tsslpt",
      type: "line",
      source: sourceId,
      "source-layer": "TSSLPT",
      paint: {
        "line-color": "#cc33aa",
        "line-width": 1,
        "line-dasharray": [6, 3],
        "line-opacity": 0.6,
      },
    },
    {
      id: "s57-resare",
      type: "line",
      source: sourceId,
      "source-layer": "RESARE",
      paint: {
        "line-color": "#dd6600",
        "line-width": 1,
        "line-dasharray": [4, 2],
        "line-opacity": 0.5,
      },
    },
    {
      id: "s57-ctnare",
      type: "line",
      source: sourceId,
      "source-layer": "CTNARE",
      paint: {
        "line-color": "#ddaa00",
        "line-width": 1,
        "line-dasharray": [4, 2],
        "line-opacity": 0.5,
      },
    },

    // ── Line layers ─────────────────────────────────────────────────────
    {
      id: "s57-depcnt",
      type: "line",
      source: sourceId,
      "source-layer": "DEPCNT",
      paint: {
        "line-color": "#6a9fc0",
        "line-width": 0.7,
      },
    },
    {
      id: "s57-coalne",
      type: "line",
      source: sourceId,
      "source-layer": "COALNE",
      paint: {
        "line-color": "#333333",
        "line-width": 1.5,
      },
    },
    {
      id: "s57-slcons",
      type: "line",
      source: sourceId,
      "source-layer": "SLCONS",
      paint: {
        "line-color": "#555555",
        "line-width": 1,
      },
    },
    {
      id: "s57-bridge",
      type: "line",
      source: sourceId,
      "source-layer": "BRIDGE",
      paint: {
        "line-color": "#664422",
        "line-width": 2,
      },
    },
    {
      id: "s57-cblsub",
      type: "line",
      source: sourceId,
      "source-layer": "CBLSUB",
      paint: {
        "line-color": "#888888",
        "line-width": 1,
        "line-dasharray": [4, 3],
      },
    },
    {
      id: "s57-cblohd",
      type: "line",
      source: sourceId,
      "source-layer": "CBLOHD",
      paint: {
        "line-color": "#cc4400",
        "line-width": 1.2,
        "line-dasharray": [5, 3],
      },
    },

    // ── Point / symbol layers ───────────────────────────────────────────
    // Soundings — depth label only (no dot without number)
    {
      id: "s57-soundg",
      type: "symbol",
      source: sourceId,
      "source-layer": "SOUNDG",
      minzoom: detailMinzoom(10),
      layout: {
        "text-field": depthTextField(depthUnit),
        "text-size": 10,
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#333333",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1,
      },
    },

    // Lights — glow ring underneath, then icon on top
    {
      id: "s57-lights-glow",
      type: "circle",
      source: sourceId,
      "source-layer": "LIGHTS",
      paint: {
        "circle-radius": 12,
        "circle-color": "rgba(255, 220, 0, 0.25)",
        "circle-blur": 0.6,
        "circle-stroke-width": 2,
        "circle-stroke-color": "rgba(255, 180, 0, 0.5)",
      },
    },
    {
      id: "s57-lights",
      type: "symbol",
      source: sourceId,
      "source-layer": "LIGHTS",
      layout: {
        "icon-image": ICON_EXPR,
        "icon-size": 0.7,
        "icon-allow-overlap": true,
        "icon-optional": true,
        "text-field": ["get", "LABEL"],
        "text-size": 10,
        "text-offset": [0, -1.5],
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": "#996600",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    },

    // Lateral buoys — icon + label
    {
      id: "s57-boylat",
      type: "symbol",
      source: sourceId,
      "source-layer": "BOYLAT",
      layout: {
        "icon-image": ICON_EXPR,
        "icon-size": 0.75,
        "icon-allow-overlap": true,
        "text-field": LABEL_EXPR,
        "text-size": 11,
        "text-offset": [0, 1.5],
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": "#333333",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    },

    // Cardinal buoys
    {
      id: "s57-boycar",
      type: "symbol",
      source: sourceId,
      "source-layer": "BOYCAR",
      layout: {
        "icon-image": ICON_EXPR,
        "icon-size": 0.75,
        "icon-allow-overlap": true,
        "text-field": LABEL_EXPR,
        "text-size": 11,
        "text-offset": [0, 1.5],
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": "#333333",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    },

    // Safe water buoys
    {
      id: "s57-boysaw",
      type: "symbol",
      source: sourceId,
      "source-layer": "BOYSAW",
      layout: {
        "icon-image": ICON_EXPR,
        "icon-size": 0.75,
        "icon-allow-overlap": true,
        "text-field": LABEL_EXPR,
        "text-size": 11,
        "text-offset": [0, 1.5],
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": "#333333",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    },

    // Special purpose buoys
    {
      id: "s57-boyspp",
      type: "symbol",
      source: sourceId,
      "source-layer": "BOYSPP",
      layout: {
        "icon-image": ICON_EXPR,
        "icon-size": 0.7,
        "icon-allow-overlap": true,
        "text-field": LABEL_EXPR,
        "text-size": 11,
        "text-offset": [0, 1.5],
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": "#333333",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    },

    // Isolated danger buoys
    {
      id: "s57-boyisd",
      type: "symbol",
      source: sourceId,
      "source-layer": "BOYISD",
      layout: {
        "icon-image": ICON_EXPR,
        "icon-size": 0.75,
        "icon-allow-overlap": true,
        "text-field": LABEL_EXPR,
        "text-size": 11,
        "text-offset": [0, 1.5],
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": "#333333",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    },

    // Lateral beacons
    {
      id: "s57-bcnlat",
      type: "symbol",
      source: sourceId,
      "source-layer": "BCNLAT",
      layout: {
        "icon-image": ICON_EXPR,
        "icon-size": 0.7,
        "icon-allow-overlap": true,
        "text-field": LABEL_EXPR,
        "text-size": 11,
        "text-offset": [0, 1.5],
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": "#333333",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    },

    // Cardinal beacons
    {
      id: "s57-bcncar",
      type: "symbol",
      source: sourceId,
      "source-layer": "BCNCAR",
      layout: {
        "icon-image": ICON_EXPR,
        "icon-size": 0.7,
        "icon-allow-overlap": true,
        "text-field": LABEL_EXPR,
        "text-size": 11,
        "text-offset": [0, 1.5],
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": "#333333",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    },

    // ── Geographic labels ─────────────────────────────────────────────
    {
      id: "s57-lndare-label",
      type: "symbol",
      source: sourceId,
      "source-layer": "LNDARE",
      minzoom: detailMinzoom(11),
      filter: ["has", "OBJNAM"],
      layout: {
        "text-field": ["get", "OBJNAM"],
        "text-size": 13,
        "text-font": ["Noto Sans Italic"],
        "text-allow-overlap": false,
        "text-padding": 10,
      },
      paint: {
        "text-color": "#5a4a32",
        "text-halo-color": "#f5e6c8",
        "text-halo-width": 1.5,
      },
    },
    // Landmarks (lighthouses, monuments, towers)
    {
      id: "s57-lndmrk-label",
      type: "symbol",
      source: sourceId,
      "source-layer": "LNDMRK",
      minzoom: detailMinzoom(12),
      filter: ["has", "OBJNAM"],
      layout: {
        "text-field": ["get", "OBJNAM"],
        "text-size": 11,
        "text-allow-overlap": true,
        "text-padding": 5,
        "text-anchor": "top",
        "text-offset": [0, 0.5],
      },
      paint: {
        "text-color": "#333333",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    },
    {
      id: "s57-berths-label",
      type: "symbol",
      source: sourceId,
      "source-layer": "BERTHS",
      minzoom: detailMinzoom(13),
      filter: ["has", "OBJNAM"],
      layout: {
        "text-field": ["get", "OBJNAM"],
        "text-size": 10,
        "text-allow-overlap": false,
        "text-padding": 5,
      },
      paint: {
        "text-color": "#555555",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1,
      },
    },
    {
      id: "s57-seaare-label",
      type: "symbol",
      source: sourceId,
      "source-layer": "SEAARE",
      minzoom: detailMinzoom(10),
      filter: ["has", "OBJNAM"],
      layout: {
        "text-field": ["get", "OBJNAM"],
        "text-size": 12,
        "text-font": ["Noto Sans Italic"],
        "text-allow-overlap": false,
        "text-padding": 10,
      },
      paint: {
        "text-color": "#3a6a3a",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    },

    // ── Hazard symbol layers ──────────────────────────────────────────
    // Wrecks
    {
      id: "s57-wrecks",
      type: "symbol",
      source: sourceId,
      "source-layer": "WRECKS",
      layout: {
        "icon-image": ICON_EXPR,
        "icon-size": 0.75,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    // Obstructions
    {
      id: "s57-obstrn",
      type: "symbol",
      source: sourceId,
      "source-layer": "OBSTRN",
      layout: {
        "icon-image": ICON_EXPR,
        "icon-size": 0.35,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    // Underwater rocks
    {
      id: "s57-uwtroc",
      type: "symbol",
      source: sourceId,
      "source-layer": "UWTROC",
      layout: {
        "icon-image": ICON_EXPR,
        "icon-size": 0.35,
        "icon-allow-overlap": false,
      },
      paint: {},
    },

    // ── Other nav aid symbol layers ───────────────────────────────────
    // Fog signals
    {
      id: "s57-fogsig",
      type: "symbol",
      source: sourceId,
      "source-layer": "FOGSIG",
      layout: {
        "icon-image": ICON_EXPR,
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
      source: sourceId,
      "source-layer": "PILPNT",
      minzoom: detailMinzoom(13),
      layout: {
        "icon-image": ICON_EXPR,
        "icon-size": 0.6,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    // Mooring facilities
    {
      id: "s57-morfac",
      type: "symbol",
      source: sourceId,
      "source-layer": "MORFAC",
      minzoom: detailMinzoom(13),
      layout: {
        "icon-image": ICON_EXPR,
        "icon-size": 0.5,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
  ];
}
