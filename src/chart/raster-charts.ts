/**
 * Raster nautical charts (NOAA RNC) composited with the vector ENC.
 *
 * Mirrors `basemap-underlay.ts`: each raster chart is a per-chart PMTiles
 * (built by tools/rnc-pipeline) streamed from the CDN or served offline from
 * OPFS. `ChartManager.buildStyle` composites these as raster layers — beneath
 * the vector ENC for the default vector-preferred quilt (ENC's opaque water
 * fills hide the raster where ENC has cells; the raster shows through where ENC
 * has no data, e.g. the BVI), or above it for the "prefer raster" override.
 */

import type { LayerSpecification, SourceSpecification } from "maplibre-gl";
import { RASTER_CHARTS, type RasterChart } from "../data/chart-catalog";
import { chartAssetBase } from "../data/remote-url";

let storedRasterCharts = new Set<string>();

/** Set the ids of raster charts downloaded to OPFS (called from main.ts). */
export function setStoredRasterCharts(ids: Set<string>): void {
  storedRasterCharts = ids;
}

export function hasStoredRasterChart(id: string): boolean {
  return storedRasterCharts.has(id);
}

/** Extract raster-chart ids from stored filenames (rnc-<id>.pmtiles). */
export function rasterChartsFromFilenames(filenames: string[]): Set<string> {
  const ids = new Set<string>();
  for (const f of filenames) {
    const m = f.match(/^rnc-(.+)\.pmtiles$/);
    if (m) ids.add(m[1]);
  }
  return ids;
}

let importedCharts: RasterChart[] = [];

/** Set user-imported charts (derived from OPFS archives; called from main.ts). */
export function setImportedRasterCharts(charts: RasterChart[]): void {
  importedCharts = charts;
}

/**
 * Raster charts to render: catalog charts plus user imports. Catalog charts
 * stream by default (tiles lazy-load only when in view); OPFS makes a
 * downloaded one work offline. Imported charts are always OPFS-backed.
 */
export function availableRasterCharts(): RasterChart[] {
  return [...RASTER_CHARTS, ...importedCharts];
}

function sourceId(chart: RasterChart): string {
  return `rnc-${chart.id}`;
}

export function getRasterChartSources(): Record<string, SourceSpecification> {
  const sources: Record<string, SourceSpecification> = {};
  for (const chart of availableRasterCharts()) {
    const url = `${chartAssetBase()}/${chart.filename}`;
    sources[sourceId(chart)] = {
      type: "raster",
      tiles: [`pmtiles://${url}/{z}/{x}/{y}`],
      tileSize: 256,
      minzoom: chart.minZoom,
      maxzoom: chart.maxZoom,
      attribution: chart.attribution ?? "NOAA RNC (public domain)",
    };
  }
  return sources;
}

export function getRasterChartLayers(): LayerSpecification[] {
  return availableRasterCharts().map((chart) => ({
    id: `${sourceId(chart)}-layer`,
    type: "raster" as const,
    source: sourceId(chart),
    minzoom: chart.minZoom,
    // No maxzoom cap: MapLibre overzooms the deepest tiles past the data zoom
    // (the overscale badge warns when that happens).
  }));
}

/** The raster chart whose footprint (bbox) contains the point, if any. */
export function rasterChartAt(lon: number, lat: number): RasterChart | null {
  for (const chart of availableRasterCharts()) {
    const [w, s, e, n] = chart.bbox;
    if (lon >= w && lon <= e && lat >= s && lat <= n) return chart;
  }
  return null;
}
