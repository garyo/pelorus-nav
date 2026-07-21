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
  // Degree-window prefilter: any entry that can score within maxNM must
  // have its center within maxNM of the point (an area only wins when the
  // point is inside a bbox whose half-diagonal — and hence center — is
  // within maxNM), so this cheap reject is exact up to the slack factor.
  // It matters because this scan runs synchronously on every waypoint
  // placement, over the merged all-region index (hundreds of thousands of
  // entries).
  const maxDegLat = (maxNM / 60) * 1.05;
  const maxDegLon = maxDegLat / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  let best: SearchEntry | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestPri = Number.POSITIVE_INFINITY;
  for (const e of entries) {
    if (!e.name || e.name.length === 0) continue;
    if (
      Math.abs(e.center[1] - lat) > maxDegLat ||
      Math.abs(e.center[0] - lon) > maxDegLon
    ) {
      continue;
    }
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
