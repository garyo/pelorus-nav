/**
 * StyleContext: shared context passed to all layer-building functions.
 */
import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { DepthUnit, DisplayTheme, SymbologyScheme } from "../../settings";
import { depthConversionFactor } from "../../settings";
import {
  type ColourScheme,
  s52Colour,
  setActiveColourScheme,
} from "../s52-colours";
import {
  buildIconExpression,
  buildLayerExpressions,
  buildOffsetExpression,
  getIconScheme,
  getIconSizeScale,
  getSchemeConfig,
} from "./icon-sets";

export interface StyleContext {
  theme: DisplayTheme;
  symbology: SymbologyScheme;
  depthUnit: DepthUnit;
  detailLevel: number;
  layerGroups: Record<string, boolean>;
  colour: (token: string) => string;
  /** Look up the sprite name for a semantic icon name in the active scheme. */
  icon: (name: string) => string;
  iconExpr: ExpressionSpecification;
  /** Sprite sheet prefix for the active symbology scheme. */
  spritePrefix: string;
  sourceId: string;
  coverageSourceId?: string;
  /** Adjusted minzoom helper: lowers base by 1 at detail level 2. */
  detailMinzoom: (base: number) => number;
  /** Whether STANDARD display category layers should be shown. */
  showStandard: boolean;
  /** Whether OTHER display category layers should be shown. */
  showOther: boolean;
  /** Icon size scale factor for the active symbology scheme. */
  iconSizeScale: number;
  /** Per-symbol icon-offset expression, or null if not needed. */
  iconOffsetExpr: ExpressionSpecification | null;
  /** Per-layer icon and offset expressions computed from raw S-57 attributes. */
  layerExprs: (layerName: string) => {
    iconExpr: ExpressionSpecification;
    offsetExpr: ExpressionSpecification | null;
  };
  /** Shallow water threshold in meters. */
  shallowDepth: number;
  /** Safety depth in meters — soundings ≤ this shown in SNDG2 (high-contrast). */
  safetyDepth: number;
  /** Deep water threshold in meters. */
  deepDepth: number;
  /** Text size scale factor (1 = default). */
  textSizeScale: number;
}

/** Map DisplayTheme to S-52 ColourScheme. */
function themeToScheme(theme: DisplayTheme): ColourScheme {
  switch (theme) {
    case "day":
      return "DAY";
    case "dusk":
      return "DUSK";
    case "night":
      return "NIGHT";
    case "eink":
      return "EINK";
  }
}

/**
 * Sort key: higher _scale_band renders on top (detailed over overview).
 * _disp_pri is constant per source layer so it adds no ordering value here;
 * draw order between layers is controlled by the style layer array order.
 */
export const SCALE_SORT_KEY = [
  "coalesce",
  ["get", "_scale_band"],
  0,
] as unknown as ExpressionSpecification;

/** Short LABEL expression: shows quoted LABEL if present, else empty string. */
const SHORT_LABEL_EXPR: ExpressionSpecification = [
  "case",
  ["all", ["has", "LABEL"], ["!=", ["get", "LABEL"], ""]],
  ["concat", '"', ["get", "LABEL"], '"'],
  "",
] as unknown as ExpressionSpecification;

/** Full label: prefers OBJNAM, falls back to the short LABEL. */
const FULL_LABEL_EXPR: ExpressionSpecification = [
  "case",
  ["all", ["has", "OBJNAM"], ["!=", ["get", "OBJNAM"], ""]],
  ["get", "OBJNAM"],
  SHORT_LABEL_EXPR,
] as unknown as ExpressionSpecification;

/**
 * Zoom at which buoy/beacon labels switch from short designation ("2")
 * to full OBJNAM ("Boston Main Channel Lighted Buoy 2"). Higher detail
 * levels (Standard+, Full) flip earlier — the user has opted into more
 * on-screen information.
 */
export function fullLabelMinZoom(ctx: StyleContext): number {
  return ctx.detailLevel >= 1 ? 14 : 15;
}

/**
 * Label expression for buoys/beacons: short designation at lower zooms,
 * full OBJNAM above the detail-dependent threshold.
 */
export function labelExpr(ctx: StyleContext): ExpressionSpecification {
  return [
    "step",
    ["zoom"],
    SHORT_LABEL_EXPR,
    fullLabelMinZoom(ctx),
    FULL_LABEL_EXPR,
  ] as unknown as ExpressionSpecification;
}

/**
 * Reusable variable-anchor layout fragment for long-ish point labels
 * (landmarks, OBJNAM names, berths, parent-light names, etc). Lets
 * MapLibre pick a placement from a priority list so labels that would
 * otherwise collision-hide find a spot around the feature.
 *
 * Note on anchor semantics: an anchor names the *part of the label
 * closest to the point*, so "top" places the label *below* the point,
 * "left" places it *to the right*, and so on.
 *
 * Priority order biases toward keeping the label below the feature
 * (traditional chart placement) and escalates to the sides and
 * finally above only when below is blocked.
 *
 * Spread this into a layer's ``layout`` and optionally override
 * ``text-radial-offset`` if the icon is unusually large/small.
 *
 * Does not apply when ``symbol-placement`` is "line" or "line-center".
 */
/**
 * ``symbol-sort-key`` constants for cross-layer collision priority.
 *
 * MapLibre places symbols in ascending sort-key order; lower keys are
 * placed first and so win collisions when ``text-allow-overlap`` is false.
 * These rankings let safety-critical navaids beat area labels (e.g. a
 * lighthouse's name beats "Massachusetts Bay" in the collision lottery).
 *
 * Leave soundings and raw numeric labels alone — their collision story
 * is governed by ``text-padding`` and they don't compete with place names.
 */
export const SORT_KEY_NAVAID = 10; // buoys, beacons, fog signals, pilings, mooring
export const SORT_KEY_LANDMARK = 20; // LNDMRK (+ PEL parent names like "Boston Light")
export const SORT_KEY_LIGHT_CHAR = 25; // LIGHTS characteristic labels (Fl(1)G 4s…)
export const SORT_KEY_HAZARD = 30; // wrecks, obstructions, UWTROC
export const SORT_KEY_FACILITY = 40; // hrbfac, berths, smcfac, buildings
export const SORT_KEY_NAMED_LAND = 50; // LNDRGN, LNDARE, LNDELV
export const SORT_KEY_AREA = 60; // SEAARE, BUAARE — last-resort placement

export const VARIABLE_ANCHOR_LAYOUT: {
  "text-variable-anchor": (
    | "top"
    | "top-right"
    | "top-left"
    | "left"
    | "right"
    | "bottom"
    | "bottom-left"
    | "bottom-right"
  )[];
  "text-radial-offset": number;
  "text-justify": "auto";
} = {
  "text-variable-anchor": [
    "top",
    "top-left",
    "top-right",
    "left",
    "right",
    "bottom",
    "bottom-left",
    "bottom-right",
  ],
  "text-radial-offset": 1.5,
  "text-justify": "auto",
};

/** Build a MapLibre expression that converts DEPTH to the given unit (no suffix). */
export function depthTextField(unit: DepthUnit): ExpressionSpecification {
  return depthFieldExpr("DEPTH", unit);
}

/**
 * Build a MapLibre expression for a LIGHTS feature's full label:
 * ``<stem> <height><h-unit><range>M``
 *
 * ``stem`` is the pre-baked LABEL ("Fl(1)G 4s") from the S-57 pipeline.
 * HEIGHT is the S-57 attribute in metres; we convert to the user's depth
 * unit at render time and append "m" or "ft". VALNMR is always nautical
 * miles ("M"). Either may be missing; the expression elides gracefully.
 *
 * Height never uses fathoms — too awkward for vertical clearances — so
 * a fathoms depth setting shows heights in feet.
 */
export function lightLabelTextField(unit: DepthUnit): ExpressionSpecification {
  // Height in metres: one decimal place. Otherwise whole feet.
  const heightUnit = unit === "meters" ? "m" : "ft";
  const heightExpr: unknown =
    unit === "meters"
      ? ["to-string", ["/", ["round", ["*", ["get", "HEIGHT"], 10]], 10]]
      : [
          "to-string",
          ["round", ["*", ["get", "HEIGHT"], depthConversionFactor("feet")]],
        ];

  const hasStem: unknown = [
    "all",
    ["has", "LABEL"],
    ["!=", ["get", "LABEL"], ""],
  ];
  const hasHeight: unknown = [
    "all",
    ["has", "HEIGHT"],
    [">", ["to-number", ["get", "HEIGHT"]], 0],
  ];
  const hasRange: unknown = [
    "all",
    ["has", "VALNMR"],
    [">", ["to-number", ["get", "VALNMR"]], 0],
  ];

  return [
    "concat",
    ["case", hasStem, ["get", "LABEL"], ""],
    // Space separator before any numeric tail.
    ["case", ["all", hasStem, ["any", hasHeight, hasRange]], " ", ""],
    ["case", hasHeight, ["concat", heightExpr, heightUnit], ""],
    ["case", hasRange, ["concat", ["to-string", ["get", "VALNMR"]], "M"], ""],
  ] as unknown as ExpressionSpecification;
}

/** Build a MapLibre expression that converts VALSOU to the given unit. */
export function valsouTextField(unit: DepthUnit): ExpressionSpecification {
  return depthFieldExpr("VALSOU", unit);
}

function depthFieldExpr(
  prop: string,
  unit: DepthUnit,
): ExpressionSpecification {
  if (unit === "meters") {
    return ["to-string", ["get", prop]] as unknown as ExpressionSpecification;
  }
  const factor = depthConversionFactor(unit);
  const decimals = unit === "fathoms" ? 1 : 0;
  const pow = 10 ** decimals;
  return [
    "to-string",
    ["/", ["round", ["*", ["*", ["get", prop], factor], pow]], pow],
  ] as unknown as ExpressionSpecification;
}

/**
 * Scale a numeric or expression-based size value by a scale factor.
 * Handles plain numbers, interpolate, and step expressions.
 */
export function scaleSize(
  base: number | ExpressionSpecification,
  scale: number,
): number | ExpressionSpecification {
  if (scale === 1.0) return base;
  if (typeof base === "number") return base * scale;
  const arr = base as unknown[];
  if (arr[0] === "interpolate") {
    const scaled = [...arr];
    for (let i = 4; i < scaled.length; i += 2) {
      if (typeof scaled[i] === "number") {
        scaled[i] = (scaled[i] as number) * scale;
      }
    }
    return scaled as unknown as ExpressionSpecification;
  }
  if (arr[0] === "step") {
    const scaled = [...arr];
    for (let i = 2; i < scaled.length; i += 2) {
      if (typeof scaled[i] === "number") {
        scaled[i] = (scaled[i] as number) * scale;
      }
    }
    return scaled as unknown as ExpressionSpecification;
  }
  return base;
}

/** Scale a text-size value by the context's textSizeScale. */
export function scaledTextSize(
  base: number | ExpressionSpecification,
  ctx: StyleContext,
): number | ExpressionSpecification {
  return scaleSize(base, ctx.textSizeScale);
}

/** Create a StyleContext from the given parameters. */
export function createStyleContext(
  sourceId: string,
  depthUnit: DepthUnit,
  detailOffset: number,
  layerGroups: Record<string, boolean>,
  theme: DisplayTheme,
  coverageSourceId?: string,
  symbology: SymbologyScheme = "pelorus-standard",
  shallowDepth = 5,
  safetyDepth = 5,
  deepDepth = 20,
  textScale = 1,
  iconScale = 1,
): StyleContext {
  // Set the active colour scheme so all s52Colour() calls use it
  setActiveColourScheme(themeToScheme(theme));

  const scheme = getIconScheme(symbology, theme);
  const config = getSchemeConfig(symbology);
  const iconExpr = buildIconExpression(scheme.icons, scheme.fallback);
  const iconOffsetExpr = config.hasOffsets
    ? buildOffsetExpression(scheme.icons)
    : null;

  return {
    theme,
    symbology,
    depthUnit,
    detailLevel: detailOffset,
    layerGroups,
    colour: (token: string) => s52Colour(token),
    icon: (name: string) => scheme.icons[name] ?? scheme.fallback,
    iconExpr,
    spritePrefix: scheme.sprite,
    sourceId,
    coverageSourceId,
    detailMinzoom: (base: number) =>
      Math.max(0, detailOffset >= 2 ? base - 1 : base),
    showStandard: detailOffset >= 0,
    showOther: detailOffset >= 1,
    iconSizeScale: getIconSizeScale(symbology, theme) * iconScale,
    iconOffsetExpr,
    layerExprs: (layerName: string) =>
      buildLayerExpressions(layerName, scheme.icons, scheme.fallback),
    shallowDepth,
    safetyDepth,
    deepDepth,
    textSizeScale: textScale,
  };
}
