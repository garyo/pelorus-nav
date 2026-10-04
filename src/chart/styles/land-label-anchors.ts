/**
 * Per-feature, per-zoom-band anchor placement for land-area (LNDARE) names.
 *
 * The tile pipeline (tools/s57-pipeline/s57_pipeline/land_labels.py) tags each
 * named LNDARE feature with hint properties `_la11` … `_la16`; `_laN` covers
 * zoom band [N, N+1), with `_la11` also used below z11 and `_la16` at z16+.
 * Hint values:
 * - `"*"` — unconstrained: default placement (polygons centred first, then
 *   the 8-direction ring; points the ring only).
 * - `"-"` — hide the label in this band.
 * - `"!"` + one code (e.g. `"!R"`, polygons only): centre then the ring,
 *   without that position.
 * - a short list of anchor codes, best first, joined by "," (e.g. `"C,B,BR,BL"`;
 *   see anchorHintValues).
 *
 * Tiles built before the hints existed have no `_laN` properties: polygons
 * then label centred only (keeping a name over its own island rather than
 * offset onto a neighbour), points keep the 8-direction ring.
 */
import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";
import { VARIABLE_ANCHOR_LAYOUT } from "./style-context";

export type TextAnchor =
  | "center"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/** Anchor codes used in `_laN` hints → MapLibre anchor names. */
export const LAND_LABEL_ANCHOR_CODES = {
  C: "center",
  T: "top",
  B: "bottom",
  L: "left",
  R: "right",
  TL: "top-left",
  TR: "top-right",
  BL: "bottom-left",
  BR: "bottom-right",
} as const satisfies Record<string, TextAnchor>;

export type AnchorCode = keyof typeof LAND_LABEL_ANCHOR_CODES;

/** Zoom bands carrying a hint property, lowest first. */
export const LAND_LABEL_HINT_BANDS = [11, 12, 13, 14, 15, 16] as const;

export const HINT_UNCONSTRAINED = "*";
export const HINT_HIDDEN = "-";

/** Name of the hint property for zoom band [zoom, zoom+1). */
export function hintProperty(zoom: number): string {
  return `_la${zoom}`;
}

type Offset = [number, number];
/** Flattened [anchor, [x, y], anchor, [x, y], …] list. */
type AnchorOffsetList = (TextAnchor | Offset)[];

/**
 * The em offset that reproduces MapLibre's `text-radial-offset` placement for
 * `anchor` (fromRadialOffset in maplibre-gl's variable_text_anchor.ts):
 * cardinal anchors sit `radius` away, diagonals at radius/√2 on each axis.
 * Anchors name the part of the label nearest the point, so "left" shifts the
 * label right (+x) and "top" shifts it down (+y).
 */
export function radialAnchorOffset(anchor: TextAnchor, radius: number): Offset {
  const x = anchor.endsWith("left") ? 1 : anchor.endsWith("right") ? -1 : 0;
  const y = anchor.startsWith("top") ? 1 : anchor.startsWith("bottom") ? -1 : 0;
  const distance = x !== 0 && y !== 0 ? radius / Math.SQRT2 : radius;
  return [x * distance, y * distance];
}

/**
 * The em offset this layer uses for `anchor`: today's radial placement,
 * rounded to 4 decimals (far below a pixel) to keep the hint tables small.
 */
export function placementOffset(anchor: TextAnchor): Offset {
  const [x, y] = radialAnchorOffset(
    anchor,
    VARIABLE_ANCHOR_LAYOUT["text-radial-offset"],
  );
  const round = (v: number) => Math.round(v * 1e4) / 1e4 || 0;
  return [round(x), round(y)];
}

function anchorOffsets(anchors: readonly TextAnchor[]): AnchorOffsetList {
  return anchors.flatMap((anchor) => [anchor, placementOffset(anchor)]);
}

const RING_ANCHORS = VARIABLE_ANCHOR_LAYOUT["text-variable-anchor"];
const RING = anchorOffsets(RING_ANCHORS);
const CENTER_ONLY = anchorOffsets(["center"]);

function literal(list: AnchorOffsetList): ExpressionSpecification {
  return ["literal", list] as unknown as ExpressionSpecification;
}

/** Placement for features without hints (tiles predating them). */
function unhintedPlacement(): ExpressionSpecification {
  return [
    "match",
    ["geometry-type"],
    ["Polygon", "MultiPolygon"],
    literal(CENTER_ONLY),
    literal(RING),
  ];
}

/** Placement for the `"*"` hint: polygons centred first, then the ring;
 *  points the ring only. */
function defaultPlacement(): ExpressionSpecification {
  return [
    "match",
    ["geometry-type"],
    ["Polygon", "MultiPolygon"],
    literal([...CENTER_ONLY, ...RING]),
    literal(RING),
  ];
}

/**
 * Offset codes in ring order: each one's label position is adjacent to its
 * neighbours'. Mirrors OFFSET_RING in land_labels.py; keep them in sync.
 */
export const OFFSET_RING = [
  "T",
  "TR",
  "R",
  "BR",
  "B",
  "BL",
  "L",
  "TL",
] as const satisfies readonly AnchorCode[];

/**
 * Every legal anchor-code hint: "C" alone, or an optional leading "C", a
 * direction, then whichever of its ring neighbours (previous, then next) are
 * also acceptable — the family land_labels.py encodes.
 */
export function anchorHintValues(): AnchorCode[][] {
  return [
    ["C"],
    ...OFFSET_RING.flatMap((best: AnchorCode, i): AnchorCode[][] => {
      const prev =
        OFFSET_RING[(i + OFFSET_RING.length - 1) % OFFSET_RING.length];
      const next = OFFSET_RING[(i + 1) % OFFSET_RING.length];
      const tails: AnchorCode[][] = [[], [prev], [next], [prev, next]];
      return tails.flatMap((tail): AnchorCode[][] => [
        [best, ...tail],
        ["C", best, ...tail],
      ]);
    }),
  ];
}

export const HINT_EXCLUDE_PREFIX = "!";

/**
 * Codes that can follow "!" in an exclusion hint: the one position over land
 * of a polygon whose other positions are all clear.
 */
export const EXCLUDABLE_CODES: readonly AnchorCode[] = ["C", ...OFFSET_RING];

/** A polygon's default order: centred, then the ring. */
const POLYGON_DEFAULT: readonly TextAnchor[] = ["center", ...RING_ANCHORS];

const toAnchors = (codes: readonly AnchorCode[]): TextAnchor[] =>
  codes.map((code) => LAND_LABEL_ANCHOR_CODES[code]);

function bandPlacement(zoom: number): ExpressionSpecification {
  const arms = [
    ...anchorHintValues().flatMap((codes) => [
      codes.join(","),
      literal(anchorOffsets(toAnchors(codes))),
    ]),
    ...EXCLUDABLE_CODES.flatMap((code) => {
      const excluded = LAND_LABEL_ANCHOR_CODES[code];
      return [
        HINT_EXCLUDE_PREFIX + code,
        literal(anchorOffsets(POLYGON_DEFAULT.filter((a) => a !== excluded))),
      ];
    }),
  ];
  return [
    "match",
    ["get", hintProperty(zoom)],
    HINT_UNCONSTRAINED,
    defaultPlacement(),
    HINT_HIDDEN,
    literal(CENTER_ONLY),
    ...arms,
    unhintedPlacement(),
  ] as unknown as ExpressionSpecification;
}

/** Top-level zoom step whose per-band values come from `perBand(zoom)`. */
function stepOverBands(
  perBand: (zoom: number) => ExpressionSpecification,
): ExpressionSpecification {
  const [first, ...rest] = LAND_LABEL_HINT_BANDS;
  return [
    "step",
    ["zoom"],
    perBand(first),
    ...rest.flatMap((zoom) => [zoom, perBand(zoom)]),
  ] as unknown as ExpressionSpecification;
}

/** `text-variable-anchor-offset` value driven by the `_laN` hints. */
export function landLabelAnchorOffset(): ExpressionSpecification {
  return stepOverBands(bandPlacement);
}

/** `text-field` value showing `name` except in bands hinted `"-"`. */
export function landLabelTextField(
  name: ExpressionSpecification,
): ExpressionSpecification {
  return stepOverBands((zoom) => [
    "case",
    ["==", ["get", hintProperty(zoom)], HINT_HIDDEN],
    "",
    name,
  ]);
}
