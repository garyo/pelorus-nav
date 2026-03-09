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
    center: [-70.9, 42.3],
    defaultZoom: 10,
  },
  {
    id: "usvi",
    name: "US Virgin Islands",
    filename: "nautical-usvi.pmtiles",
    coverageFilename: "nautical-usvi.coverage.geojson",
    sizeEstimate: 10 * 1024 * 1024, // estimate, TBD
    center: [-64.9, 18.0],
    defaultZoom: 11,
  },
];

/** Look up a region by ID. */
export function getRegion(id: string): ChartRegion | undefined {
  return CHART_REGIONS.find((r) => r.id === id);
}
