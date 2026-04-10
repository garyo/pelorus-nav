/**
 * Static catalog of available chart regions.
 *
 * Each region corresponds to a PMTiles file served from R2.
 * Users can stream tiles remotely or download for offline use.
 */

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

/**
 * Available chart regions.
 * Order determines display order in the UI.
 */
export const CHART_REGIONS: ChartRegion[] = [
  {
    id: "northern-new-england",
    name: "Northern New England",
    filename: "nautical-northern-new-england.pmtiles",
    coverageFilename: "nautical-northern-new-england.coverage.geojson",
    sizeEstimate: 150 * 1024 * 1024, // ~150 MB (estimate)
    center: [-71.01, 42.34],
    defaultZoom: 12,
    bbox: [-74.0, 42.0, -65.5, 48.0],
  },
  {
    id: "southern-new-england",
    name: "Southern New England",
    filename: "nautical-southern-new-england.pmtiles",
    coverageFilename: "nautical-southern-new-england.coverage.geojson",
    sizeEstimate: 150 * 1024 * 1024, // ~150 MB (estimate)
    center: [-71.5, 41.5],
    defaultZoom: 11,
    bbox: [-74.0, 41.0, -65.5, 42.0],
  },
  {
    id: "new-york",
    name: "New York & NJ",
    filename: "nautical-new-york.pmtiles",
    coverageFilename: "nautical-new-york.coverage.geojson",
    sizeEstimate: 200 * 1024 * 1024, // ~200 MB (estimate)
    center: [-73.8, 40.4],
    defaultZoom: 10,
    bbox: [-76.0, 39.0, -65.5, 41.0],
  },
  {
    id: "mid-atlantic",
    name: "Mid-Atlantic",
    filename: "nautical-mid-atlantic.pmtiles",
    coverageFilename: "nautical-mid-atlantic.coverage.geojson",
    sizeEstimate: 250 * 1024 * 1024, // ~250 MB (estimate)
    center: [-76.0, 37.5],
    defaultZoom: 9,
    bbox: [-77.5, 35.0, -65.5, 39.0],
  },
  {
    id: "south-atlantic",
    name: "South Atlantic",
    filename: "nautical-south-atlantic.pmtiles",
    coverageFilename: "nautical-south-atlantic.coverage.geojson",
    sizeEstimate: 400 * 1024 * 1024, // ~400 MB (estimate)
    center: [-80.0, 30.0],
    defaultZoom: 8,
    bbox: [-82.5, 24.3, -65.5, 35.0],
  },
  {
    id: "usvi",
    name: "USVI & Puerto Rico",
    filename: "nautical-usvi.pmtiles",
    coverageFilename: "nautical-usvi.coverage.geojson",
    sizeEstimate: 24 * 1024 * 1024, // ~24 MB
    center: [-64.930893, 18.335314],
    defaultZoom: 12,
    bbox: [-67.5, 17.5, -64.0, 19.0],
  },
];

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
