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
  /** Offline street basemap PMTiles filename (only for regions with one built) */
  basemapFilename?: string;
  /** Approximate basemap size in bytes */
  basemapSizeEstimate?: number;
  /** Default map center [lon, lat] */
  center: [number, number];
  /** Default zoom level */
  defaultZoom: number;
  /** Bounding box [west, south, east, north] for fast GPS hit-testing */
  bbox: [number, number, number, number];
}

interface DisplayMeta {
  sizeEstimate: number;
  /** Set once the region's street basemap has been built and uploaded. */
  basemapSizeEstimate?: number;
  center: [number, number];
  defaultZoom: number;
}

/** Client-only display metadata keyed by region id. */
const DISPLAY: Record<string, DisplayMeta> = {
  "northern-new-england": {
    sizeEstimate: 150 * 1024 * 1024,
    basemapSizeEstimate: 250 * 1024 * 1024,
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
  washington: {
    sizeEstimate: 90 * 1024 * 1024,
    center: [-122.45, 47.6],
    defaultZoom: 9,
  },
  oregon: {
    sizeEstimate: 60 * 1024 * 1024,
    center: [-124.0, 44.5],
    defaultZoom: 8,
  },
  "northern-california": {
    sizeEstimate: 25 * 1024 * 1024,
    center: [-123.8, 39.8],
    defaultZoom: 8,
  },
  "central-california": {
    sizeEstimate: 50 * 1024 * 1024,
    center: [-122.45, 37.78],
    defaultZoom: 10,
  },
  "southern-california": {
    sizeEstimate: 45 * 1024 * 1024,
    center: [-118.4, 33.7],
    defaultZoom: 10,
  },
  hawaii: {
    sizeEstimate: 50 * 1024 * 1024,
    center: [-157.85, 21.3],
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
      ...(meta.basemapSizeEstimate && {
        basemapFilename: `basemap-${r.id}.pmtiles`,
        basemapSizeEstimate: meta.basemapSizeEstimate,
      }),
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

/** AABB overlap test for [west, south, east, north] boxes (quick-reject). */
export function bboxIntersects(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

/**
 * Region ids whose layers should be present for the current view: the active
 * region (always) plus any region whose bbox overlaps the viewport. This keeps
 * the chart style to a handful of regions instead of all ~16, without the user
 * ever seeing a boundary. `bounds` null (e.g. before the map exists) → active
 * region only.
 */
export function regionsInView(
  bounds: [number, number, number, number] | null,
  activeRegion: string,
): string[] {
  return CHART_REGIONS.filter(
    (r) =>
      r.id === activeRegion ||
      (bounds !== null && bboxIntersects(r.bbox, bounds)),
  ).map((r) => r.id);
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

/**
 * A downloadable data asset contributed by a plugin (e.g. the tides bundle,
 * a weather cache). Surfaced alongside chart regions in the download UI.
 * Distinct from `ChartRegion`, which the vector chart provider special-cases.
 */
export interface DataAsset {
  /** Unique id, e.g. "tides-bundle". */
  id: string;
  /** Display name in the download UI. */
  label: string;
  /** Source URL (relative to origin, served same-origin when bundled). */
  url: string;
  /** OPFS filename for the offline copy. */
  filename: string;
  /** Approximate size in bytes for the UI. */
  sizeEstimate: number;
}

/**
 * A raster chart (NOAA RNC, converted to raster PMTiles by tools/rnc-pipeline).
 * Composited beneath the vector ENC (vector-preferred quilting); fills areas the
 * vector charts don't cover (e.g. the BVI, which NOAA never vectorised).
 */
export interface RasterChart {
  id: string;
  name: string;
  filename: string; // rnc-<id>.pmtiles
  coverageFilename: string; // rnc-<id>.coverage.geojson (chart footprint)
  sizeEstimate: number;
  /** Compilation scale, e.g. 100000 for 1:100k. */
  scale: number;
  /** Slippy zoom where the chart is "native"; past it the display is overscale. */
  nativeZoom: number;
  /** Tile zoom range in the PMTiles. */
  minZoom: number;
  maxZoom: number;
  center: [number, number];
  bbox: [number, number, number, number]; // [west, south, east, north]
}

export const RASTER_CHARTS: RasterChart[] = [
  {
    id: "bvi",
    name: "British Virgin Islands (NOAA 25641)",
    filename: "rnc-bvi.pmtiles",
    coverageFilename: "rnc-bvi.coverage.geojson",
    sizeEstimate: 32 * 1024 * 1024,
    scale: 100000,
    nativeZoom: 13,
    minZoom: 8,
    maxZoom: 14,
    center: [-64.62, 18.42],
    bbox: [-65.11, 17.582, -64.366, 18.548],
  },
];

const dataAssets: DataAsset[] = [];

/** Register a plugin data asset; appears in the Chart Regions download panel. */
export function registerDataAsset(asset: DataAsset): void {
  if (!dataAssets.some((a) => a.id === asset.id)) dataAssets.push(asset);
}

/** All plugin-registered downloadable data assets. */
export function getDataAssets(): readonly DataAsset[] {
  return dataAssets;
}
