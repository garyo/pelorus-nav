/**
 * Static catalog of available chart regions.
 *
 * Each region corresponds to a PMTiles file served from R2.
 * Users can stream tiles remotely or download for offline use.
 *
 * Id, name, and bbox are the shared source of truth in tools/regions.json
 * (also consumed by the Python tile pipeline). Display metadata below
 * (center, defaultZoom, sizeEstimate) is client-only.
 */

import regionsJson from "../../tools/regions.json";

export interface ChartRegion {
  /** Unique slug, e.g. "new-england" */
  id: string;
  /** Display name */
  name: string;
  /** PMTiles filename on server and in OPFS */
  filename: string;
  /** Coverage GeoJSON filename */
  coverageFilename: string;
  /** Approximate file size in bytes (for UI display before download) */
  sizeEstimate: number;
  /** Default map center [lon, lat] */
  center: [number, number];
  /** Default zoom level */
  defaultZoom: number;
  /** Bounding box [west, south, east, north] for fast GPS hit-testing */
  bbox: [number, number, number, number];
}

interface DisplayMeta {
  sizeEstimate: number;
  center: [number, number];
  defaultZoom: number;
}

/** Client-only display metadata keyed by region id. */
const DISPLAY: Record<string, DisplayMeta> = {
  "northern-new-england": {
    sizeEstimate: 150 * 1024 * 1024,
    center: [-71.01, 42.34],
    defaultZoom: 12,
  },
  "southern-new-england": {
    sizeEstimate: 150 * 1024 * 1024,
    center: [-71.5, 41.5],
    defaultZoom: 11,
  },
  "new-york": {
    sizeEstimate: 200 * 1024 * 1024,
    center: [-73.8, 40.4],
    defaultZoom: 10,
  },
  "mid-atlantic": {
    sizeEstimate: 250 * 1024 * 1024,
    center: [-76.0, 37.5],
    defaultZoom: 9,
  },
  "south-atlantic": {
    sizeEstimate: 400 * 1024 * 1024,
    center: [-80.0, 30.0],
    defaultZoom: 8,
  },
  usvi: {
    sizeEstimate: 24 * 1024 * 1024,
    center: [-64.930893, 18.335314],
    defaultZoom: 12,
  },
  "gulf-coast": {
    sizeEstimate: 500 * 1024 * 1024,
    center: [-88.0, 28.5],
    defaultZoom: 7,
  },
  "great-lakes": {
    sizeEstimate: 400 * 1024 * 1024,
    center: [-84.0, 45.0],
    defaultZoom: 6,
  },
  "ny-inland": {
    sizeEstimate: 75 * 1024 * 1024,
    center: [-76.5, 43.0],
    defaultZoom: 8,
  },
};

/** Region ids excluded from the production client catalog. */
const CLIENT_EXCLUDE = new Set<string>(["boston-test"]);

interface RegionJsonEntry {
  id: string;
  name: string;
  bbox: [number, number, number, number];
}

/**
 * Available chart regions.
 * Order determines display order in the UI (follows tools/regions.json).
 */
export const CHART_REGIONS: ChartRegion[] = (regionsJson as RegionJsonEntry[])
  .filter((r) => !CLIENT_EXCLUDE.has(r.id))
  .map((r) => {
    const meta = DISPLAY[r.id];
    if (!meta) {
      throw new Error(
        `chart-catalog: missing display metadata for region "${r.id}"`,
      );
    }
    return {
      id: r.id,
      name: r.name,
      filename: `nautical-${r.id}.pmtiles`,
      coverageFilename: `nautical-${r.id}.coverage.geojson`,
      sizeEstimate: meta.sizeEstimate,
      center: meta.center,
      defaultZoom: meta.defaultZoom,
      bbox: r.bbox,
    };
  });

// S-64 ECDIS test dataset — dev only, not shipped to production.
// Two test areas: GB cells (~61°E, 32.5°S) and AA cells (~105°W, 40°N).
if (import.meta.env.DEV) {
  CHART_REGIONS.push({
    id: "s64-test",
    name: "S-64 ECDIS Test Data",
    filename: "nautical-s64-test.pmtiles",
    coverageFilename: "nautical-s64-test.coverage.geojson",
    sizeEstimate: 5 * 1024 * 1024,
    center: [61.05, -32.48],
    defaultZoom: 12,
    // Only covers the GB test cells (south Indian Ocean). AA cells at -105°W/40°N
    // are outside this bbox but still accessible via manual navigation.
    bbox: [60.5, -33.0, 61.5, -32.0],
  });
}

/** MapLibre vector source IDs for all regions. */
export function getVectorSourceIds(): string[] {
  return CHART_REGIONS.map((r) => `s57-vector-${r.id}`);
}

/** Build region-prefixed layer IDs for a given base suffix. */
export function getRegionLayerIds(suffix: string): string[] {
  return CHART_REGIONS.map((r) => `s57-${r.id}-${suffix}`);
}

/** Look up a region by ID. */
export function getRegion(id: string): ChartRegion | undefined {
  return CHART_REGIONS.find((r) => r.id === id);
}

/** Find the first region whose bbox contains the given position. */
export function findRegionForPosition(
  lat: number,
  lon: number,
): ChartRegion | undefined {
  return CHART_REGIONS.find((r) => {
    const [west, south, east, north] = r.bbox;
    return lon >= west && lon <= east && lat >= south && lat <= north;
  });
}
