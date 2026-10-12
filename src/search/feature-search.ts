/**
 * Pure search algorithm for chart feature names.
 *
 * Scores features by text match quality and optional proximity to a
 * reference point, returning ranked results with human-readable type labels
 * and where each one is. A query may end in ", place" to narrow it.
 */

import { LAYER_NAMES } from "../chart/feature-info";
import type { SearchEntry } from "../data/search-index";
import { describeLocation, nearestTown, placeMatcher } from "./places";
import { approxDistanceNM, entriesNear, latSorted } from "./spatial";

export interface SearchResult {
  entry: SearchEntry;
  score: number;
  matchType: "exact" | "prefix" | "word-prefix" | "substring";
  typeLabel: string;
  /** Distance from reference point in nautical miles, if available. */
  distanceNM?: number;
  /** Where the feature is: "near Coronado, CA". */
  location?: string;
}

export interface SearchOptions {
  /** Reference point [lon, lat] for proximity boost (GPS or map center). */
  referencePoint?: [number, number];
  /** Viewport bounds [west, south, east, north] for in-view boost. */
  viewportBounds?: [number, number, number, number];
  /** Maximum results to return (default: 15). */
  limit?: number;
}

/** Convert nautical miles to meters. */
const METERS_PER_NM = 1852;

/** Type priority for tiebreaking (lower = higher priority). */
const TYPE_PRIORITY: Record<string, number> = {
  BUAARE: 0,
  LNDMRK: 5,
  SEAARE: 10,
  LNDARE: 12,
  LNDRGN: 13,
  BRIDGE: 15,
  HRBFAC: 16,
  SMCFAC: 17,
  RESARE: 20,
  ACHARE: 21,
  FAIRWY: 22,
  CTNARE: 23,
  BOYLAT: 30,
  BOYCAR: 30,
  BOYSAW: 30,
  BOYSPP: 30,
  BOYISD: 30,
  BCNLAT: 31,
  BCNCAR: 31,
  BCNSPP: 31,
  LIGHTS: 32,
  WRECKS: 35,
  OBSTRN: 36,
};

/** Least padding around each piece when matching up duplicates (see `reach`). */
const DUPLICATE_GAP_NM = 0.1;

type BBox = [number, number, number, number];

function isInBounds(
  point: [number, number],
  bounds: [number, number, number, number],
): boolean {
  const [west, south, east, north] = bounds;
  return (
    point[0] >= west &&
    point[0] <= east &&
    point[1] >= south &&
    point[1] <= north
  );
}

/** Characters that separate words in feature names. */
const WORD_BREAKS = " \t-/,";

/**
 * Score a feature name against a query string.
 * Returns [score, matchType] or null if no match.
 */
function scoreText(
  nameLower: string,
  queryLower: string,
): [number, SearchResult["matchType"]] | null {
  const at = nameLower.indexOf(queryLower);
  if (at < 0) return null;
  if (at === 0) {
    return nameLower === queryLower ? [100, "exact"] : [80, "prefix"];
  }
  // Word-boundary prefix: the query starts a word somewhere in the name
  for (let i = at; i >= 0; i = nameLower.indexOf(queryLower, i + 1)) {
    if (WORD_BREAKS.includes(nameLower[i - 1])) return [60, "word-prefix"];
  }
  return [40, "substring"];
}

/** A query split at its last comma: "coronado, ca" → "coronado" + "ca". */
export interface ParsedQuery {
  /** Lower-case name part. */
  name: string;
  /** Lower-case place part, if any. */
  where?: string;
}

export function parseSearchQuery(query: string): ParsedQuery {
  const lower = query.trim().toLowerCase();
  const comma = lower.lastIndexOf(",");
  if (comma < 0) return { name: lower };
  const name = lower.slice(0, comma).trim();
  const where = lower.slice(comma + 1).trim();
  return where ? { name, where } : { name };
}

/**
 * An entry's extent grown by a quarter of its size, and at least
 * DUPLICATE_GAP_NM. Same-named pieces whose reaches overlap are one feature
 * split across chart cells, or drawn again at another scale.
 */
function reach(entry: SearchEntry): BBox {
  const [lon, lat] = entry.center;
  const [w, s, e, n] = entry.bbox ?? [lon, lat, lon, lat];
  const cosLat = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  const sizeNM = Math.max((n - s) * 60, (e - w) * 60 * cosLat);
  const padLat = Math.max(DUPLICATE_GAP_NM, sizeNM / 4) / 60;
  const padLon = padLat / cosLat;
  return [w - padLon, s - padLat, e + padLon, n + padLat];
}

function overlaps(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** A search result with its duplicate key: type plus lower-case name. */
interface Candidate {
  result: SearchResult;
  key: string;
}

/**
 * Keep the best-ranked piece of each feature: drop results with the same
 * name and type as a better-ranked one whose reach overlaps theirs, directly
 * or through other such pieces.
 */
function collapseDuplicates(ranked: Candidate[]): SearchResult[] {
  interface Group {
    lead: SearchResult;
    reaches: BBox[];
  }
  // Most names occur once, and need no geometry.
  const counts = new Map<string, number>();
  for (const { key } of ranked) counts.set(key, (counts.get(key) ?? 0) + 1);

  const groupsByKey = new Map<string, Group[]>();
  const dropped = new Set<SearchResult>();
  for (const { result, key } of ranked) {
    if (counts.get(key) === 1) continue;
    const r = reach(result.entry);
    let groups = groupsByKey.get(key);
    if (!groups) {
      groups = [];
      groupsByKey.set(key, groups);
    }
    const touching = groups.filter((g) =>
      g.reaches.some((b) => overlaps(b, r)),
    );
    if (touching.length === 0) {
      groups.push({ lead: result, reaches: [r] });
      continue;
    }
    // Groups are in rank order, so the first touching one has the best lead.
    const [first, ...rest] = touching;
    first.reaches.push(r);
    dropped.add(result);
    for (const g of rest) {
      first.reaches.push(...g.reaches);
      dropped.add(g.lead);
      groups.splice(groups.indexOf(g), 1);
    }
  }
  return ranked.filter((c) => !dropped.has(c.result)).map((c) => c.result);
}

const lowerNamesCache = new WeakMap<SearchEntry[], string[]>();

/** Lower-case names of `entries`, by index, computed once per array. */
function lowerNames(entries: SearchEntry[]): string[] {
  let names = lowerNamesCache.get(entries);
  if (!names) {
    names = entries.map((e) => e.name.toLowerCase());
    lowerNamesCache.set(entries, names);
  }
  return names;
}

function compareResults(a: SearchResult, b: SearchResult): number {
  // Score desc, then type priority asc, then nearest, then name asc
  if (b.score !== a.score) return b.score - a.score;
  const aPri = TYPE_PRIORITY[a.entry.type] ?? 50;
  const bPri = TYPE_PRIORITY[b.entry.type] ?? 50;
  if (aPri !== bPri) return aPri - bPri;
  const dist = (a.distanceNM ?? 0) - (b.distanceNM ?? 0);
  if (dist !== 0) return dist;
  return a.entry.name.localeCompare(b.entry.name);
}

/**
 * Search features by name with optional proximity boosting.
 *
 * @param query - User's search text (min 2 chars).
 * @param entries - All loaded search index entries.
 * @param options - Optional proximity and limit settings.
 * @returns Ranked search results, highest score first.
 */
export function searchFeatures(
  query: string,
  entries: SearchEntry[],
  options?: SearchOptions,
): SearchResult[] {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const queryLower = trimmed.toLowerCase();
  const { name, where } = parseSearchQuery(trimmed);
  const limit = options?.limit ?? 15;
  const refPoint = options?.referencePoint;
  const viewport = options?.viewportBounds;

  const names = lowerNames(entries);
  const inPlace = where ? placeMatcher(where, entries) : undefined;
  const candidates: Candidate[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const nameLower = names[i];
    // The whole query first, for the few names that contain a comma.
    let textResult = scoreText(nameLower, queryLower);
    if (!textResult && inPlace && name.length >= 2) {
      textResult = scoreText(nameLower, name);
      if (textResult && !inPlace(entry)) textResult = null;
    }
    if (!textResult) continue;

    let [score, matchType] = textResult;

    // Proximity boost
    let distanceNM: number | undefined;
    if (refPoint) {
      distanceNM = approxDistanceNM(refPoint, entry.center);
    }
    if (viewport && isInBounds(entry.center, viewport)) {
      score += 20;
    } else if (distanceNM !== undefined && distanceNM < 50) {
      score += 10;
    }

    candidates.push({
      result: {
        entry,
        score,
        matchType,
        typeLabel: LAYER_NAMES[entry.type] ?? entry.type,
        distanceNM,
      },
      key: `${entry.type}|${nameLower}`,
    });
  }

  candidates.sort((a, b) => compareResults(a.result, b.result));
  const top = collapseDuplicates(candidates).slice(0, limit);
  for (const result of top) {
    result.location = describeLocation(
      result.entry,
      nearestTown(result.entry, entries),
    );
  }
  return top;
}

/**
 * "Effective distance" of a feature from a click point, for picking the
 * most specific name. For point features it's just the centroid distance.
 * For an area feature when the click is *inside* its bbox, it's the
 * half-diagonal of that bbox: a tighter area (small anchorage) scores
 * better than a sprawling one (whole Gulf), so the more specific name
 * wins. Centroid distance still applies when outside the bbox.
 */
function effectiveDistanceNM(e: SearchEntry, ref: [number, number]): number {
  if (e.bbox) {
    const [w, s, ee, n] = e.bbox;
    if (ref[0] >= w && ref[0] <= ee && ref[1] >= s && ref[1] <= n) {
      const widthNM = approxDistanceNM([w, (s + n) / 2], [ee, (s + n) / 2]);
      const heightNM = approxDistanceNM([(w + ee) / 2, s], [(w + ee) / 2, n]);
      return Math.sqrt(widthNM * widthNM + heightNM * heightNM) / 2;
    }
  }
  return approxDistanceNM(ref, e.center);
}

/**
 * Find the nearest named chart feature to a [lon, lat] point. Used for
 * auto-suggesting waypoint names from the chart.
 *
 * - Point features compete on centroid distance.
 * - Area features (with a `bbox`) score by their half-diagonal *when the
 *   click is inside the bbox* — small named areas (anchorages, harbours)
 *   score well, sprawling areas (Gulf of Maine) effectively never match.
 *   This means a real nearby point feature reliably outranks the
 *   enclosing area, which is what you want for a waypoint name.
 * - Ties within 30 m fall back to TYPE_PRIORITY.
 */
export function findNearestNamedFeature(
  lon: number,
  lat: number,
  entries: SearchEntry[],
  maxMeters = 1500,
): SearchEntry | null {
  const ref: [number, number] = [lon, lat];
  const maxNM = maxMeters / METERS_PER_NM;
  let best: SearchEntry | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestPri = Number.POSITIVE_INFINITY;
  // Any entry that can score within maxNM has its center within maxNM of the
  // point (an area only wins when the point is inside a bbox whose
  // half-diagonal — and hence center — is within maxNM).
  for (const e of entriesNear(latSorted(entries), ref, maxNM)) {
    if (!e.name || e.name.length === 0) continue;
    const d = effectiveDistanceNM(e, ref);
    if (d > maxNM) continue;
    const pri = TYPE_PRIORITY[e.type] ?? 50;
    const nearTie = Math.abs(d - bestDist) * METERS_PER_NM < 30;
    if (d < bestDist - 1e-9 && !nearTie) {
      best = e;
      bestDist = d;
      bestPri = pri;
    } else if (nearTie && pri < bestPri) {
      best = e;
      bestDist = d;
      bestPri = pri;
    }
  }
  return best;
}
