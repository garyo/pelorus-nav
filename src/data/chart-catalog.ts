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
    id: "new-england",
    name: "New England",
    filename: "nautical-new-england.pmtiles",
    coverageFilename: "nautical-new-england.coverage.geojson",
    sizeEstimate: 287 * 1024 * 1024, // ~287 MB
    center: [-71.00992, 42.341893],
    defaultZoom: 12,
    bbox: [-74.0, 41.0, -65.5, 47.5],
  },
  {
    id: "new-york",
    name: "New York & NJ",
    filename: "nautical-new-york.pmtiles",
    coverageFilename: "nautical-new-york.coverage.geojson",
    sizeEstimate: 200 * 1024 * 1024, // ~200 MB (estimate)
    center: [-73.8, 40.4],
    defaultZoom: 10,
    bbox: [-76.0, 39.0, -71.0, 41.0],
  },
  {
    id: "mid-atlantic",
    name: "Mid-Atlantic",
    filename: "nautical-mid-atlantic.pmtiles",
    coverageFilename: "nautical-mid-atlantic.coverage.geojson",
    sizeEstimate: 250 * 1024 * 1024, // ~250 MB (estimate)
    center: [-76.0, 37.5],
    defaultZoom: 9,
    bbox: [-77.5, 35.0, -74.5, 39.0],
  },
  {
    id: "south-atlantic",
    name: "South Atlantic",
    filename: "nautical-south-atlantic.pmtiles",
    coverageFilename: "nautical-south-atlantic.coverage.geojson",
    sizeEstimate: 400 * 1024 * 1024, // ~400 MB (estimate)
    center: [-80.0, 30.0],
    defaultZoom: 8,
    bbox: [-82.5, 24.3, -75.0, 35.0],
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
