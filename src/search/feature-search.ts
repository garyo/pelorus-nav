/**
 * Pure search algorithm for chart feature names.
 *
 * Scores features by text match quality and optional proximity to a
 * reference point, returning ranked results with human-readable type labels.
 */

import { LAYER_NAMES } from "../chart/feature-info";
import type { SearchEntry } from "../data/search-index";

export interface SearchResult {
  entry: SearchEntry;
  score: number;
  matchType: "exact" | "prefix" | "word-prefix" | "substring";
  typeLabel: string;
  /** Distance from reference point in nautical miles, if available. */
  distanceNM?: number;
}

export interface SearchOptions {
  /** Reference point [lon, lat] for proximity boost (GPS or map center). */
  referencePoint?: [number, number];
  /** Viewport bounds [west, south, east, north] for in-view boost. */
  viewportBounds?: [number, number, number, number];
  /** Maximum results to return (default: 15). */
  limit?: number;
}

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

/**
 * Approximate distance in nautical miles between two [lon, lat] points.
 * Uses equirectangular approximation — good enough for ranking.
 */
function approxDistanceNM(a: [number, number], b: [number, number]): number {
  const dLat = (b[1] - a[1]) * 60;
  const dLon =
    (b[0] - a[0]) * 60 * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

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

/**
 * Score a feature name against a query string.
 * Returns [score, matchType] or null if no match.
 */
function scoreText(
  nameLower: string,
  queryLower: string,
): [number, SearchResult["matchType"]] | null {
  if (nameLower === queryLower) return [100, "exact"];
  if (nameLower.startsWith(queryLower)) return [80, "prefix"];

  // Word-boundary prefix: any word in the name starts with the query
  const words = nameLower.split(/[\s\-/,]+/);
  for (const word of words) {
    if (word.startsWith(queryLower)) return [60, "word-prefix"];
  }

  if (nameLower.includes(queryLower)) return [40, "substring"];

  return null;
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
  const limit = options?.limit ?? 15;
  const refPoint = options?.referencePoint;
  const viewport = options?.viewportBounds;

  const results: SearchResult[] = [];

  for (const entry of entries) {
    const nameLower = entry.name.toLowerCase();
    const textResult = scoreText(nameLower, queryLower);
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

    results.push({
      entry,
      score,
      matchType,
      typeLabel: LAYER_NAMES[entry.type] ?? entry.type,
      distanceNM,
    });
  }

  // Sort: score desc, then type priority asc, then name asc
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aPri = TYPE_PRIORITY[a.entry.type] ?? 50;
    const bPri = TYPE_PRIORITY[b.entry.type] ?? 50;
    if (aPri !== bPri) return aPri - bPri;
    return a.entry.name.localeCompare(b.entry.name);
  });

  return results.slice(0, limit);
}
