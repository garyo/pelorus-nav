/**
 * Where a search result is: its nearest town and its state or country.
 * Results show it ("near Coronado, CA"), and a query's ", place" suffix
 * matches it ("coronado, ca", "long island, maine", "long island, boston").
 */

import type { SearchEntry } from "../data/search-index";
import { approxDistanceNM, entriesNear, latSorted } from "./spatial";

/** A town farther than this doesn't help say where a feature is. */
const TOWN_RADIUS_NM = 10;

const townsCache = new WeakMap<SearchEntry[], SearchEntry[]>();

/** The built-up areas (towns and cities) among `entries`, lat-sorted. */
function towns(entries: SearchEntry[]): SearchEntry[] {
  let found = townsCache.get(entries);
  if (!found) {
    found = latSorted(entries).filter((e) => e.type === "BUAARE");
    townsCache.set(entries, found);
  }
  return found;
}

/** Distance from a point to a town: zero anywhere inside its bbox. */
function townDistanceNM(town: SearchEntry, point: [number, number]): number {
  if (town.bbox) {
    const [w, s, e, n] = town.bbox;
    if (point[0] >= w && point[0] <= e && point[1] >= s && point[1] <= n) {
      return 0;
    }
  }
  return approxDistanceNM(point, town.center);
}

/** Towns within TOWN_RADIUS_NM of a feature, with their distances. */
function townsNear(
  entry: SearchEntry,
  entries: SearchEntry[],
): { town: SearchEntry; distanceNM: number }[] {
  return entriesNear(towns(entries), entry.center, TOWN_RADIUS_NM)
    .map((town) => ({ town, distanceNM: townDistanceNM(town, entry.center) }))
    .filter((t) => t.distanceNM < TOWN_RADIUS_NM);
}

/** The town nearest a feature, if one is close; none for towns themselves. */
export function nearestTown(
  entry: SearchEntry,
  entries: SearchEntry[],
): SearchEntry | undefined {
  if (entry.type === "BUAARE") return undefined;
  let best: { town: SearchEntry; distanceNM: number } | undefined;
  for (const near of townsNear(entry, entries)) {
    if (!best || near.distanceNM < best.distanceNM) best = near;
  }
  return best?.town;
}

/** "near Coronado, CA", "near Coronado", "CA", or undefined. */
export function describeLocation(
  entry: SearchEntry,
  town: SearchEntry | undefined,
): string | undefined {
  const label = entry.place?.label;
  if (!town) return label;
  return label ? `near ${town.name}, ${label}` : `near ${town.name}`;
}

/** Whether a word in `text` (lower case) starts with `prefix`. */
function hasWordStarting(text: string, prefix: string): boolean {
  return text.startsWith(prefix) || text.includes(` ${prefix}`);
}

/**
 * A test of whether a query's place suffix (lower case) fits a feature: a
 * state or country code exactly ("ca", "usa"), or the start of a word in its
 * state or country name ("calif", "virgin") or in the name of a town within
 * TOWN_RADIUS_NM ("boston"). Names need three letters or more, so "ma" means
 * Massachusetts, not Manitoba or Marblehead.
 */
export function placeMatcher(
  where: string,
  entries: SearchEntry[],
): (entry: SearchEntry) => boolean {
  const named = where.length >= 3;
  const matchingTowns = named
    ? towns(entries).filter((t) => hasWordStarting(t.name.toLowerCase(), where))
    : [];
  return (entry) => {
    const place = entry.place;
    if (place?.codes.includes(where)) return true;
    if (!named) return false;
    if (place?.names.some((n) => hasWordStarting(n, where))) return true;
    return matchingTowns.some(
      (town) => townDistanceNM(town, entry.center) < TOWN_RADIUS_NM,
    );
  };
}
