/**
 * Loads and caches search index files for chart feature name search.
 *
 * Each region has a `.search.json` file containing named features with
 * their types, centroids, and optional bounding boxes.
 */

import { CHART_REGIONS, type ChartRegion } from "./chart-catalog";
import { chartAssetBase } from "./remote-url";

/** A single named feature from the search index. */
export interface SearchEntry {
  name: string;
  type: string; // S-57 layer name (BUAARE, LNDARE, etc.)
  center: [number, number]; // [lon, lat]
  bbox?: [number, number, number, number]; // [west, south, east, north]
  label?: string; // short label (e.g. buoy number)
}

/** Raw compact format from the JSON file. */
interface RawEntry {
  n: string;
  t: string;
  c: [number, number];
  b?: [number, number, number, number];
  l?: string;
}

interface RawIndex {
  version: number;
  features: RawEntry[];
}

/** In-memory cache keyed by region ID. */
const cache = new Map<string, SearchEntry[]>();

function searchIndexFilename(region: ChartRegion): string {
  // e.g. "nautical-northern-new-england.pmtiles" → "nautical-northern-new-england.search.json"
  return region.filename.replace(".pmtiles", ".search.json");
}

function parseRawEntry(raw: RawEntry): SearchEntry {
  return {
    name: raw.n,
    type: raw.t,
    center: raw.c,
    bbox: raw.b,
    label: raw.l,
  };
}

/**
 * Load the search index for a single region.
 * Returns cached results on subsequent calls.
 */
export async function loadSearchIndex(
  regionId: string,
): Promise<SearchEntry[]> {
  const cached = cache.get(regionId);
  if (cached) return cached;

  const region = CHART_REGIONS.find((r) => r.id === regionId);
  if (!region) return [];

  const filename = searchIndexFilename(region);
  const url = `${chartAssetBase()}/${filename}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data: RawIndex = await resp.json();
    if (data.version !== 1 || !Array.isArray(data.features)) return [];
    const entries = data.features.map(parseRawEntry);
    cache.set(regionId, entries);
    return entries;
  } catch {
    // Index file may not exist yet for this region
    return [];
  }
}

/**
 * Load search indices for all regions in parallel.
 * Returns a merged, deduplicated array.
 */
export async function loadAllSearchIndices(): Promise<SearchEntry[]> {
  const results = await Promise.all(
    CHART_REGIONS.map((r) => loadSearchIndex(r.id)),
  );
  // Deduplicate across regions (same feature may appear at region boundaries)
  const seen = new Set<string>();
  const merged: SearchEntry[] = [];
  for (const entries of results) {
    for (const entry of entries) {
      const key = `${entry.name.toLowerCase()}|${entry.type}|${entry.center[0]}|${entry.center[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(entry);
      }
    }
  }
  return merged;
}

/** Clear the in-memory cache (e.g. after downloading new charts). */
export function clearSearchIndexCache(): void {
  cache.clear();
}
