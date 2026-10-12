/**
 * Distance and lookup helpers over search-index entries.
 */

import type { SearchEntry } from "../data/search-index";

/**
 * Approximate distance in nautical miles between two [lon, lat] points.
 * Uses equirectangular approximation — good enough for ranking.
 */
export function approxDistanceNM(
  a: [number, number],
  b: [number, number],
): number {
  const dLat = (b[1] - a[1]) * 60;
  const dLon =
    (b[0] - a[0]) * 60 * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/**
 * Lat-sorted copies of entry arrays, built once per array identity so
 * nearest-feature lookups can binary-search a narrow latitude band instead
 * of scanning the whole merged all-region index (hundreds of thousands of
 * entries) on every lookup.
 */
const latSortedCache = new WeakMap<SearchEntry[], SearchEntry[]>();

export function latSorted(entries: SearchEntry[]): SearchEntry[] {
  let sorted = latSortedCache.get(entries);
  if (!sorted) {
    sorted = [...entries].sort((a, b) => a.center[1] - b.center[1]);
    latSortedCache.set(entries, sorted);
  }
  return sorted;
}

/** First index in lat-sorted `entries` with center lat >= `lat`. */
export function lowerBoundByLat(entries: SearchEntry[], lat: number): number {
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].center[1] < lat) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Entries whose centers lie within `radiusNM` of `point` (a lat band plus a
 * longitude check, so a few slightly farther ones may be included), from
 * lat-sorted `sorted`.
 */
export function entriesNear(
  sorted: SearchEntry[],
  point: [number, number],
  radiusNM: number,
): SearchEntry[] {
  const [lon, lat] = point;
  const maxDegLat = (radiusNM / 60) * 1.05;
  const maxDegLon = maxDegLat / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  const end = lowerBoundByLat(sorted, lat + maxDegLat);
  const near: SearchEntry[] = [];
  for (let i = lowerBoundByLat(sorted, lat - maxDegLat); i < end; i++) {
    if (Math.abs(sorted[i].center[0] - lon) <= maxDegLon) near.push(sorted[i]);
  }
  return near;
}
