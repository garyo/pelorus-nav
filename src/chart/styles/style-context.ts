/**
 * StyleContext: shared context passed to all layer-building functions.
 */
import type { ExpressionSpecification } from "maplibre-gl";
import type { DepthUnit, DisplayTheme } from "../../settings";
import { depthConversionFactor } from "../../settings";
import {
  type ColourScheme,
  s52Colour,
  setActiveColourScheme,
} from "../s52-colours";
import { buildIconExpression, ECDIS_SIMPLIFIED } from "./icon-sets";

export interface StyleContext {
  theme: DisplayTheme;
  depthUnit: DepthUnit;
  detailLevel: number;
  layerGroups: Record<string, boolean>;
  colour: (token: string) => string;
  iconExpr: ExpressionSpecification;
  sourceId: string;
  coverageSourceId?: string;
  /** Adjusted minzoom helper: lowers base by 1 at detail level 2. */
  detailMinzoom: (base: number) => number;
  /** Whether STANDARD display category layers should be shown. */
  showStandard: boolean;
  /** Whether OTHER display category layers should be shown. */
  showOther: boolean;
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
 * Composite sort-key: combines S-52 display priority and scale band.
 * Lower _disp_pri draws first (area fills before symbols), and within
 * the same priority, higher _scale_band renders on top (detailed over overview).
 */
export const SCALE_SORT_KEY = [
  "+",
  ["*", ["coalesce", ["get", "_disp_pri"], 0], 10],
  ["coalesce", ["get", "_scale_band"], 0],
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
): StyleContext {
  // Set the active colour scheme so all s52Colour() calls use it
  setActiveColourScheme(themeToScheme(theme));

  const iconExpr = buildIconExpression(ECDIS_SIMPLIFIED, "ecdis-buoy-default");

  return {
    theme,
    depthUnit,
    detailLevel: detailOffset,
    layerGroups,
    colour: (token: string) => s52Colour(token),
    iconExpr,
    sourceId,
    coverageSourceId,
    detailMinzoom: (base: number) =>
      Math.max(0, detailOffset >= 2 ? base - 1 : base),
    showStandard: detailOffset >= 0,
    showOther: detailOffset >= 1,
  };
}
