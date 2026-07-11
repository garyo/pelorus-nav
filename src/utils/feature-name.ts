/**
 * Shorten a charted-feature name (S-57 OBJNAM) into a compact, still-legible
 * waypoint label. Chart names can be verbose ("Peddocks Island Channel
 * Hospital Shoal Buoy HS"); auto-named waypoints read better abbreviated.
 *
 * Strategy: expand nothing, abbreviate common nautical words, and drop the
 * redundant standalone "Buoy" word — a lone designation ("7", "2P", "HS") is
 * standard marine idiom. "Lighted Buoy" collapses to "LB" so the lighted
 * distinction survives.
 */

import { haversineDistanceNM } from "./coordinates";

/** Multi-word phrases replaced before per-word abbreviation. */
const PHRASE_ABBREV: [RegExp, string][] = [
  [/\blighted\s+buoy\b/gi, "LB"],
  [/\blighted\s+bell\s+buoy\b/gi, "LBB"],
];

/** Single-word abbreviations, keyed by lowercase word. */
const WORD_ABBREV: Record<string, string> = {
  channel: "Chan",
  daybeacon: "Daybcn",
  island: "Is",
  islands: "Is",
  light: "Lt",
  lights: "Lts",
  shoal: "Shl",
  shoals: "Shl",
  hospital: "Hosp",
  point: "Pt",
  harbor: "Hbr",
  harbour: "Hbr",
  rock: "Rk",
  rocks: "Rks",
  ledge: "Ldg",
  ledges: "Ldg",
  junction: "Jct",
  entrance: "Ent",
  approach: "Appr",
  and: "&",
};

/** Standalone words dropped entirely (the trailing designation stands alone). */
const DROP_WORDS = new Set(["buoy", "the"]);

/**
 * Abbreviate a chart feature name for use as a waypoint label. Returns the
 * input trimmed if abbreviation would leave nothing.
 */
export function abbreviateFeatureName(name: string): string {
  let out = name;
  for (const [re, sub] of PHRASE_ABBREV) out = out.replace(re, sub);

  const words = out.trim().split(/\s+/);
  const kept: string[] = [];
  for (const word of words) {
    const lower = word.toLowerCase();
    if (DROP_WORDS.has(lower)) continue;
    kept.push(WORD_ABBREV[lower] ?? word);
  }

  const result = kept.join(" ");
  return result.length > 0 ? result : name.trim();
}

/**
 * Max distance at which a same-named adjacent waypoint makes a
 * feature-derived name redundant: two points placed near the same charted
 * feature both inherit its name, and the repeat is clutter. Same-named
 * features farther apart than this are genuinely distinct (or an
 * out-and-back past the same mark) and keep their names.
 */
export const NEAR_DUPLICATE_M = 500;

/**
 * Whether `name` duplicates a nearby neighbor's name (case- and
 * whitespace-insensitive, within NEAR_DUPLICATE_M). Callers fall back to a
 * numbered WP-style name when this returns true.
 */
export function isNearDuplicateName(
  name: string,
  lat: number,
  lon: number,
  neighbors: { name: string; lat: number; lon: number }[],
): boolean {
  const norm = name.trim().toLowerCase();
  return neighbors.some(
    (n) =>
      n.name.trim().toLowerCase() === norm &&
      haversineDistanceNM(lat, lon, n.lat, n.lon) * 1852 <= NEAR_DUPLICATE_M,
  );
}
