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
    center: [-71.00992, 42.341893],
    defaultZoom: 12,
  },
  {
    id: "usvi",
    name: "USVI & Puerto Rico",
    filename: "nautical-usvi.pmtiles",
    coverageFilename: "nautical-usvi.coverage.geojson",
    sizeEstimate: 24 * 1024 * 1024, // ~24 MB
    center: [-64.930893, 18.335314],
    defaultZoom: 12,
  },
];

/** Look up a region by ID. */
export function getRegion(id: string): ChartRegion | undefined {
  return CHART_REGIONS.find((r) => r.id === id);
}
