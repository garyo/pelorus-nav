/**
 * User-imported raster charts (bring-your-own .pmtiles).
 *
 * "Load from File…" (ChartCachePanel) stores any .pmtiles in OPFS. Files the
 * catalog doesn't know are derived into RasterChart entries here by reading
 * the PMTiles header (tile type, bounds, zoom range, center) and metadata
 * (name, attribution), then merged into availableRasterCharts() so they
 * render exactly like catalog RNC charts. Raster archives only — a vector
 * (MVT) import has no style to render with, so it stays stored-but-undrawn.
 */

import { PMTiles, TileType } from "pmtiles";
import {
  CHART_REGIONS,
  RASTER_CHARTS,
  type RasterChart,
} from "../data/chart-catalog";
import { OPFSSource } from "../data/opfs-source";
import { getChartFile, type StoredChartInfo } from "../data/tile-store";
import { computeFootprint } from "./chart-footprint";

/** The slice of the PMTiles interface derivation needs (stubbed in tests). */
export interface PMTilesLike {
  getHeader(): Promise<{
    tileType: TileType;
    minZoom: number;
    maxZoom: number;
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  }>;
  getMetadata(): Promise<unknown>;
}

/** True if the filename belongs to the built-in catalog (never "imported"). */
export function isCatalogFilename(filename: string): boolean {
  return (
    CHART_REGIONS.some(
      (r) => r.filename === filename || r.basemapFilename === filename,
    ) || RASTER_CHARTS.some((rc) => rc.filename === filename)
  );
}

/** Attribution strings from arbitrary archives may carry HTML — keep text only. */
function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "").trim();
}

/**
 * Derive a RasterChart from an imported archive's header/metadata, or null
 * for vector archives. The id is prefixed so it can never collide with a
 * catalog chart's MapLibre source id.
 */
export async function rasterChartFromPMTiles(
  archive: PMTilesLike,
  filename: string,
  sizeBytes: number,
): Promise<RasterChart | null> {
  const header = await archive.getHeader();
  if (header.tileType === TileType.Mvt || header.tileType === TileType.Mlt) {
    return null;
  }
  const meta = (await archive.getMetadata().catch(() => null)) as {
    name?: string;
    attribution?: string;
  } | null;

  const stem = filename.replace(/\.pmtiles$/, "");
  const bbox: [number, number, number, number] = [
    header.minLon,
    header.minLat,
    header.maxLon,
    header.maxLat,
  ];
  // Always the bbox centroid — header centers in the wild are unreliable
  // (pmtiles convert has been seen writing a bogus centerLon).
  const center: [number, number] = [
    (bbox[0] + bbox[2]) / 2,
    (bbox[1] + bbox[3]) / 2,
  ];

  return {
    id: `import-${stem}`,
    name: meta?.name?.trim() || stem,
    filename,
    coverageFilename: `${stem}.coverage.geojson`, // rarely exists; bbox fallback
    sizeEstimate: sizeBytes,
    // Imagery is native at its deepest tile zoom; scale is display-only here.
    scale: Math.round(559082264 / 2 ** header.maxZoom),
    nativeZoom: header.maxZoom,
    minZoom: header.minZoom,
    maxZoom: header.maxZoom,
    center,
    bbox,
    attribution: meta?.attribution
      ? stripTags(meta.attribution)
      : "Imported chart",
    imported: true,
  };
}

/**
 * Build RasterChart entries for every stored non-catalog raster archive.
 * Unreadable files (not actually PMTiles, corrupt) are skipped with a warning
 * — they still appear in the panel as plain imported rows.
 */
export async function deriveImportedRasterCharts(
  stored: StoredChartInfo[],
): Promise<RasterChart[]> {
  const charts: RasterChart[] = [];
  for (const info of stored) {
    if (!info.filename.endsWith(".pmtiles")) continue;
    if (isCatalogFilename(info.filename)) continue;
    const file = await getChartFile(info.filename);
    if (!file) continue;
    try {
      const archive = new PMTiles(new OPFSSource(file, info.filename));
      const chart = await rasterChartFromPMTiles(
        archive,
        info.filename,
        info.sizeBytes,
      );
      if (!chart) continue;
      try {
        // Best-effort: bbox outline still works without it.
        chart.footprint = (await computeFootprint(archive)) ?? undefined;
      } catch {
        // corrupt/odd directory — keep the chart, lose the fancy outline
      }
      charts.push(chart);
    } catch (err) {
      console.warn(`Skipping unreadable imported chart ${info.filename}:`, err);
    }
  }
  return charts;
}
