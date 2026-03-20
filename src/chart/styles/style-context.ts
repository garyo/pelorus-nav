/**
 * StyleContext: shared context passed to all layer-building functions.
 */
import type { ExpressionSpecification } from "maplibre-gl";
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
  /** Deep water threshold in meters. */
  deepDepth: number;
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

/** Label expression: shows quoted LABEL if present, else empty string. */
export const LABEL_EXPR = [
  "case",
  ["all", ["has", "LABEL"], ["!=", ["get", "LABEL"], ""]],
  ["concat", '"', ["get", "LABEL"], '"'],
  "",
] as unknown as ExpressionSpecification;

/** Build a MapLibre expression that converts DEPTH to the given unit (no suffix). */
export function depthTextField(unit: DepthUnit): ExpressionSpecification {
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
  deepDepth = 20,
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
    iconExpr,
    spritePrefix: scheme.sprite,
    sourceId,
    coverageSourceId,
    detailMinzoom: (base: number) =>
      Math.max(0, detailOffset >= 2 ? base - 1 : base),
    showStandard: detailOffset >= 0,
    showOther: detailOffset >= 1,
    iconSizeScale: getIconSizeScale(symbology, theme),
    iconOffsetExpr,
    layerExprs: (layerName: string) =>
      buildLayerExpressions(layerName, scheme.icons, scheme.fallback),
    shallowDepth,
    deepDepth,
  };
}
