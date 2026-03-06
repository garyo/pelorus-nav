import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";
import { type DepthUnit, depthConversionFactor } from "../settings";
import { buildIconExpression, ECDIS_SIMPLIFIED } from "./icon-sets";
import { s52Colour } from "./s52-colours";

/**
 * Nautical chart style layers for S-57 vector tiles.
 * Uses sprite-based ECDIS simplified symbology.
 *
 * Layer ordering:
 *   1. Background
 *   2. Fill layers — terrain first, then regulatory overlays
 *   3. Line layers
 *   4. Point/symbol layers
 *
 * Multi-scale quilting:
 *   Features carry a `_scale_band` property (0=overview, 1=coastal,
 *   2=approach, 3=harbor). Fill and line layers use sort-key expressions
 *   so that higher-scale (more detailed) data renders on top of
 *   lower-scale data, preventing coastline "echo" artifacts without
 *   needing maxzoom capping (which caused coverage gaps).
 */

/**
 * Composite sort-key: combines S-52 display priority and scale band.
 * Lower _disp_pri draws first (area fills before symbols), and within
 * the same priority, higher _scale_band renders on top (detailed over overview).
 */
const SCALE_SORT_KEY = [
  "+",
  ["*", ["coalesce", ["get", "_disp_pri"], 0], 10],
  ["coalesce", ["get", "_scale_band"], 0],
] as unknown as ExpressionSpecification;

/** Label expression: shows quoted LABEL if present, else empty string. */
const LABEL_EXPR = [
  "case",
  ["all", ["has", "LABEL"], ["!=", ["get", "LABEL"], ""]],
  ["concat", '"', ["get", "LABEL"], '"'],
  "",
] as unknown as ExpressionSpecification;

/** Icon expression for the current icon set. */
const ICON_EXPR = buildIconExpression(ECDIS_SIMPLIFIED, "ecdis-buoy-default");

/** Build a MapLibre expression that converts DEPTH to the given unit (no suffix). */
function depthTextField(unit: DepthUnit): ExpressionSpecification {
  if (unit === "meters") {
    return [
      "to-string",
      ["get", "DEPTH"],
    ] as unknown as ExpressionSpecification;
  }
  const factor = depthConversionFactor(unit);
  const decimals = unit === "fathoms" ? 1 : 0;
  const pow = 10 ** decimals;
  return [
    "to-string",
    ["/", ["round", ["*", ["*", ["get", "DEPTH"], factor], pow]], pow],
  ] as unknown as ExpressionSpecification;
}

/**
 * Generate DEPARE + LNDARE fill layers for a scale-band tier.
 * Each tier draws water (DEPARE) first, then land (LNDARE) on top,
 * so land correctly covers water within the same scale band.
 * Fine tier draws after coarse tier, so detailed data wins.
 */
function terrainFillTier(
  sourceId: string,
  tier: string,
  bandFilter: ExpressionSpecification,
): LayerSpecification[] {
  const depareFilter = (
    depthFilter: ExpressionSpecification,
  ): ExpressionSpecification =>
    ["all", bandFilter, depthFilter] as unknown as ExpressionSpecification;

  return [
    {
      id: `s57-depare-shallow-${tier}`,
      type: "fill",
      source: sourceId,
      "source-layer": "DEPARE",
      filter: depareFilter(["<", ["get", "DRVAL1"], 5]),
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": s52Colour("DEPVS"),
        "fill-opacity": 0.9,
      },
    },
    {
      id: `s57-depare-medium-${tier}`,
      type: "fill",
      source: sourceId,
      "source-layer": "DEPARE",
      filter: depareFilter([
        "all",
        [">=", ["get", "DRVAL1"], 5],
        ["<", ["get", "DRVAL1"], 20],
      ]),
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": s52Colour("DEPMS"),
        "fill-opacity": 0.9,
      },
    },
    {
      id: `s57-depare-deep-${tier}`,
      type: "fill",
      source: sourceId,
      "source-layer": "DEPARE",
      filter: depareFilter([">=", ["get", "DRVAL1"], 20]),
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": s52Colour("DEPDW"),
        "fill-opacity": 0.9,
      },
    },
    {
      id: `s57-depare-drying-${tier}`,
      type: "fill",
      source: sourceId,
      "source-layer": "DEPARE",
      filter: depareFilter(["<", ["get", "DRVAL1"], 0]),
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": s52Colour("DEPIT"),
        "fill-opacity": 0.9,
      },
    },
    {
      id: `s57-lndare-${tier}`,
      type: "fill",
      source: sourceId,
      "source-layer": "LNDARE",
      filter: bandFilter,
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": s52Colour("LANDA"),
        "fill-opacity": 1,
      },
    },
    {
      id: `s57-coalne-${tier}`,
      type: "line",
      source: sourceId,
      "source-layer": "COALNE",
      filter: bandFilter,
      layout: { "line-sort-key": SCALE_SORT_KEY },
      paint: {
        "line-color": s52Colour("CSTLN"),
        "line-width": 1.5,
      },
    },
  ] as LayerSpecification[];
}

export function getNauticalLayers(
  sourceId: string,
  depthUnit: DepthUnit = "meters",
  detailOffset = 0,
): LayerSpecification[] {
  // Detail levels map to display categories:
  //   -2, -1: DISPLAYBASE only
  //   0: DISPLAYBASE + STANDARD
  //   1: DISPLAYBASE + STANDARD + OTHER
  //   2: all (+ lower minzoom for dense features)
  const detailMinzoom = (base: number) =>
    Math.max(0, detailOffset >= 2 ? base - 1 : base);

  // Category visibility based on detail level
  const showStandard = detailOffset >= 0;
  const showOther = detailOffset >= 1;

  // Filter helper: returns false for layers that should be hidden
  const catFilter = (
    category: "DISPLAYBASE" | "STANDARD" | "OTHER",
  ): boolean => {
    if (category === "DISPLAYBASE") return true;
    if (category === "STANDARD") return showStandard;
    return showOther;
  };

  // Build layer array, filtering by display category
  const layers: LayerSpecification[] = [
    // ── Background ──────────────────────────────────────────────────────
    {
      id: "s57-background",
      type: "background",
      paint: {
        "background-color": s52Colour("DEPDW"),
      },
    },

    // ── Fill layers: terrain (two-tier multi-scale compositing) ──────────
    // Tier 1 (coarse): draw DEPARE then LNDARE for bands 0-2
    // Tier 2 (fine): draw DEPARE then LNDARE for bands 3+ on top
    // This ensures fine-scale data completely replaces coarse data
    // in its coverage area, with correct land/water ordering per tier.
    ...terrainFillTier(sourceId, "coarse", [
      "<=",
      ["coalesce", ["get", "_scale_band"], 0],
      2,
    ]),
    ...terrainFillTier(sourceId, "fine", [
      ">",
      ["coalesce", ["get", "_scale_band"], 0],
      2,
    ]),
    {
      id: "s57-lakare",
      type: "fill",
      source: sourceId,
      "source-layer": "LAKARE",
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": s52Colour("DEPMD"),
        "fill-opacity": 0.8,
      },
    },
    {
      id: "s57-rivers",
      type: "fill",
      source: sourceId,
      "source-layer": "RIVERS",
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": s52Colour("DEPMD"),
        "fill-opacity": 0.8,
      },
    },
    {
      id: "s57-drgare",
      type: "fill",
      source: sourceId,
      "source-layer": "DRGARE",
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": s52Colour("DEPMS"),
        "fill-opacity": 0.5,
      },
    },
    {
      id: "s57-drgare-outline",
      type: "line",
      source: sourceId,
      "source-layer": "DRGARE",
      layout: { "line-sort-key": SCALE_SORT_KEY },
      paint: {
        "line-color": s52Colour("RADHI"),
        "line-width": 1,
        "line-dasharray": [4, 3],
      },
    },
    {
      id: "s57-ponton",
      type: "fill",
      source: sourceId,
      "source-layer": "PONTON",
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": s52Colour("NODTA"),
        "fill-opacity": 0.8,
      },
    },
    {
      id: "s57-buisgl",
      type: "fill",
      source: sourceId,
      "source-layer": "BUISGL",
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": s52Colour("LANDF"),
        "fill-opacity": 0.7,
      },
    },
    {
      id: "s57-buisgl-outline",
      type: "line",
      source: sourceId,
      "source-layer": "BUISGL",
      layout: { "line-sort-key": SCALE_SORT_KEY },
      paint: {
        "line-color": s52Colour("PAYLC"),
        "line-width": 0.5,
      },
    },
    {
      id: "s57-unsare",
      type: "fill",
      source: sourceId,
      "source-layer": "UNSARE",
      layout: { "fill-sort-key": SCALE_SORT_KEY },
      paint: {
        "fill-color": s52Colour("NODTA"),
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
        "line-color": s52Colour("APTS1"),
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
        "line-color": s52Colour("RESBL"),
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
        "line-color": s52Colour("TRFCD"),
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
        "line-color": s52Colour("CHMGD"),
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
        "line-color": s52Colour("CHMGF"),
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
      layout: { "line-sort-key": SCALE_SORT_KEY },
      paint: {
        "line-color": s52Colour("CHGRD"),
        "line-width": 0.7,
      },
    },
    {
      id: "s57-slcons",
      type: "line",
      source: sourceId,
      "source-layer": "SLCONS",
      layout: { "line-sort-key": SCALE_SORT_KEY },
      paint: {
        "line-color": s52Colour("CHGRF"),
        "line-width": 1,
      },
    },
    {
      id: "s57-bridge",
      type: "line",
      source: sourceId,
      "source-layer": "BRIDGE",
      paint: {
        "line-color": s52Colour("CHBRN"),
        "line-width": 2,
      },
    },
    {
      id: "s57-cblsub",
      type: "line",
      source: sourceId,
      "source-layer": "CBLSUB",
      paint: {
        "line-color": s52Colour("ISDNG"),
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
        "line-color": s52Colour("OUTLW"),
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
      layout: {
        "text-field": depthTextField(depthUnit),
        "text-size": 10,
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": s52Colour("SNDG1"),
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
        "text-color": s52Colour("SNDG2"),
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
        "text-color": s52Colour("CHBLK"),
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
        "text-color": s52Colour("CHBLK"),
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
        "text-color": s52Colour("CHBLK"),
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
        "text-color": s52Colour("CHBLK"),
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
        "text-color": s52Colour("CHBLK"),
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
        "text-color": s52Colour("CHBLK"),
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
        "text-color": s52Colour("CHBLK"),
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
        "text-color": s52Colour("NINFO"),
        "text-halo-color": s52Colour("LANDA"),
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
        "text-color": s52Colour("CHBLK"),
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
        "text-color": s52Colour("CHGRF"),
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
        "text-color": s52Colour("BKAJ1"),
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

  // Display category → layer ID mapping for filtering
  // DISPLAYBASE layers are always shown; STANDARD/OTHER filtered by detail
  const LAYER_CATEGORIES: Record<string, "DISPLAYBASE" | "STANDARD" | "OTHER"> =
    {
      "s57-lndare-coarse": "DISPLAYBASE",
      "s57-lndare-fine": "DISPLAYBASE",
      "s57-depare-shallow-coarse": "DISPLAYBASE",
      "s57-depare-shallow-fine": "DISPLAYBASE",
      "s57-depare-medium-coarse": "DISPLAYBASE",
      "s57-depare-medium-fine": "DISPLAYBASE",
      "s57-depare-deep-coarse": "DISPLAYBASE",
      "s57-depare-deep-fine": "DISPLAYBASE",
      "s57-depare-drying-coarse": "DISPLAYBASE",
      "s57-depare-drying-fine": "DISPLAYBASE",
      "s57-unsare": "DISPLAYBASE",
      "s57-coalne-coarse": "DISPLAYBASE",
      "s57-coalne-fine": "DISPLAYBASE",
      "s57-depcnt": "DISPLAYBASE",
      "s57-soundg": "DISPLAYBASE",
      "s57-wrecks": "DISPLAYBASE",
      "s57-obstrn": "DISPLAYBASE",
      "s57-uwtroc": "DISPLAYBASE",
      "s57-background": "DISPLAYBASE",
      // STANDARD
      "s57-lakare": "STANDARD",
      "s57-rivers": "STANDARD",
      "s57-drgare": "STANDARD",
      "s57-drgare-outline": "STANDARD",
      "s57-slcons": "STANDARD",
      "s57-bridge": "STANDARD",
      "s57-cblsub": "STANDARD",
      "s57-cblohd": "STANDARD",
      "s57-fairwy": "STANDARD",
      "s57-fairwy-outline": "STANDARD",
      "s57-achare": "STANDARD",
      "s57-tsslpt": "STANDARD",
      "s57-resare": "STANDARD",
      "s57-ctnare": "STANDARD",
      "s57-boylat": "STANDARD",
      "s57-boycar": "STANDARD",
      "s57-boysaw": "STANDARD",
      "s57-boyspp": "STANDARD",
      "s57-boyisd": "STANDARD",
      "s57-bcnlat": "STANDARD",
      "s57-bcncar": "STANDARD",
      "s57-lights": "STANDARD",
      "s57-lights-glow": "STANDARD",
      "s57-fogsig": "STANDARD",
      "s57-lndmrk-label": "STANDARD",
      "s57-lndare-label": "STANDARD",
      "s57-seaare-label": "STANDARD",
      // OTHER
      "s57-buisgl": "OTHER",
      "s57-buisgl-outline": "OTHER",
      "s57-ponton": "OTHER",
      "s57-berths-label": "OTHER",
      "s57-pilpnt": "OTHER",
      "s57-morfac": "OTHER",
    };

  return layers.filter((layer) => {
    const cat = LAYER_CATEGORIES[layer.id];
    return cat === undefined || catFilter(cat);
  });
}
