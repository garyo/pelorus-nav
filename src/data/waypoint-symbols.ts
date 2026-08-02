/**
 * Translating between our waypoint icons and other chartplotters' `<sym>`.
 *
 * GPX 1.1 puts no vocabulary behind `<sym>` — it is free text, "the exact
 * spelling of the symbol on the GPS" — so every producer speaks its own
 * dialect: Garmin writes `Triangle, Red`, OpenCPN writes `diamond`. Garmin
 * has no colour field at all; the colour is half of the symbol name.
 *
 * Our icons come in two kinds, and the split is deliberate:
 *
 * - **Semantic** (anchorage, hazard, fuel, poi, cob) — a meaning, drawn in a
 *   fixed colour it owns. A green hazard would be a lie, so these take no
 *   colour.
 * - **Geometric** (triangle, circle, square, …) — a shape that means whatever
 *   the skipper decided, carrying a colour they chose. This is the kind
 *   Garmin users have, and the kind a re-coloured import has to land on.
 *
 * Reading is generous (anything recognizable, any case, colour optional) and
 * writing is conservative (a name the far side is likely to know).
 */

import type { WaypointIcon } from "./Waypoint";

/** Icons whose colour the user picks. The rest own their colour. */
export const GEOMETRIC_ICONS = [
  "triangle",
  "circle",
  "square",
  "diamond",
  "flag",
  "pin",
  "house",
] as const;

export type GeometricIcon = (typeof GEOMETRIC_ICONS)[number];

export function isGeometricIcon(icon: WaypointIcon): icon is GeometricIcon {
  return (GEOMETRIC_ICONS as readonly string[]).includes(icon);
}

/**
 * The colours a geometric icon can take, as names rather than free hex.
 *
 * Named, because a colour has to survive a round trip: there is no
 * `Triangle, #7F3FBF` to write back into a GPX, and a name maps both ways.
 * Small, because these are read at a glance on a moving boat, over blue water
 * and buff land — every one of them has to stay legible against both.
 */
export const WAYPOINT_COLORS = {
  red: "#cc2222",
  orange: "#ff8800",
  yellow: "#ddbb00",
  green: "#22aa44",
  blue: "#3366cc",
  magenta: "#bb33aa",
} as const;

export type WaypointColor = keyof typeof WAYPOINT_COLORS;

export const WAYPOINT_COLOR_NAMES = Object.keys(
  WAYPOINT_COLORS,
) as WaypointColor[];

/** Colour of a geometric icon that never got one (or lost it to a bad value). */
export const DEFAULT_WAYPOINT_COLOR: WaypointColor = "orange";

export function waypointColorHex(color: WaypointColor | undefined): string {
  return WAYPOINT_COLORS[color ?? DEFAULT_WAYPOINT_COLOR];
}

export function isWaypointColor(value: string): value is WaypointColor {
  return value in WAYPOINT_COLORS;
}

/**
 * `<sym>` shape words we accept, beyond the icon names themselves. Garmin's
 * spellings and OpenCPN's, plus the obvious synonyms — reading costs nothing
 * and a name we don't know silently becomes a plain dot.
 */
const SHAPE_ALIASES: Record<string, WaypointIcon> = {
  waypoint: "default",
  dot: "default",
  marker: "default",
  anchor: "anchorage",
  anchorage: "anchorage",
  caution: "hazard",
  danger: "hazard",
  hazard: "hazard",
  "skull and crossbones": "hazard",
  fuel: "fuel",
  "gas station": "fuel",
  poi: "poi",
  star: "poi",
  cob: "cob",
  mob: "cob",
  "man overboard": "cob",
  triangle: "triangle",
  circle: "circle",
  square: "square",
  box: "square",
  diamond: "diamond",
  flag: "flag",
  pin: "pin",
  house: "house",
  home: "house",
  residence: "house",
};

/** Colour words we accept, mapped onto the palette. */
const COLOR_ALIASES: Record<string, WaypointColor> = {
  red: "red",
  orange: "orange",
  amber: "orange",
  yellow: "yellow",
  gold: "yellow",
  green: "green",
  blue: "blue",
  cyan: "blue",
  magenta: "magenta",
  violet: "magenta",
  purple: "magenta",
  pink: "magenta",
};

/**
 * How we spell each icon on the way out. Garmin's own names where we're
 * confident of the spelling, ours otherwise — `<sym>` is free text, so a name
 * the far side doesn't know lands on its default symbol, exactly as an
 * unrecognized name does today.
 */
const SYM_NAMES: Record<WaypointIcon, string> = {
  default: "Waypoint",
  anchorage: "Anchor",
  hazard: "Caution",
  fuel: "Gas Station",
  poi: "Star",
  cob: "Man Overboard",
  triangle: "Triangle",
  circle: "Circle",
  square: "Square",
  diamond: "Diamond",
  flag: "Flag",
  pin: "Pin",
  house: "Residence",
};

export interface ParsedSym {
  icon: WaypointIcon;
  /** Only ever set for a geometric icon — see the module note. */
  color?: WaypointColor;
}

/**
 * Read a `<sym>`: a shape, optionally followed by a colour after a comma.
 *
 * Unknown shapes become a plain waypoint rather than being dropped, and an
 * unknown colour leaves the shape at its default rather than failing the
 * whole symbol — half a symbol beats none.
 */
export function parseWaypointSym(sym: string | null | undefined): ParsedSym {
  if (!sym) return { icon: "default" };
  const [shapePart, colorPart] = sym.split(",");
  const shape = shapePart.trim().toLowerCase();
  const icon = SHAPE_ALIASES[shape] ?? "default";
  if (!isGeometricIcon(icon)) return { icon };
  const color = COLOR_ALIASES[(colorPart ?? "").trim().toLowerCase()];
  return color ? { icon, color } : { icon };
}

/** Write a `<sym>`: "Triangle, Red" for a coloured shape, "Anchor" otherwise. */
export function formatWaypointSym(
  icon: WaypointIcon,
  color?: WaypointColor,
): string {
  const name = SYM_NAMES[icon] ?? SYM_NAMES.default;
  if (!isGeometricIcon(icon) || !color) return name;
  return `${name}, ${color[0].toUpperCase()}${color.slice(1)}`;
}
