/**
 * OPFS-backed offline charts in the PMTiles protocol.
 *
 * Tracks which protocol entries are backed by OPFS files and owns the one
 * reload sequence — used both at boot (before the map exists) and when the
 * Chart Regions panel changes the downloaded set — that re-registers stored
 * charts and re-derives the basemap/raster/imported-chart lists from them.
 */
import { PMTiles, type Protocol } from "pmtiles";
import { OPFSSource } from "../data/opfs-source";
import { chartAssetBase } from "../data/remote-url";
import { getChartFile, listStoredCharts } from "../data/tile-store";
import { appErrorLog, formatErrorDetail } from "../diagnostics/errorLog";
import { getSettings } from "../settings";
import {
  basemapRegionsFromFilenames,
  loadBasemapCoverage,
  setStoredBasemaps,
} from "./basemap-underlay";
import { deriveImportedRasterCharts } from "./imported-charts";
import {
  rasterChartsFromFilenames,
  setImportedRasterCharts,
  setStoredRasterCharts,
} from "./raster-charts";

export interface ReloadOfflineChartsDeps {
  /**
   * Follow-up refresh work that needs the reloaded chart set (e.g.
   * re-deriving offline coverage and streaming versions once the map
   * exists). Runs inside the same failure handling as the reload itself.
   */
  afterReload?: () => Promise<void>;
}

export interface OfflineChartRegistry {
  /** True while any protocol entry is backed by a downloaded OPFS chart. */
  hasOfflineCharts(): boolean;
  /**
   * Retry hook for the chart-load failure banner: drop cached streaming
   * PMTiles instances so the style rebuild can refetch them — pmtiles caches
   * a rejected header promise forever, so after a network failure the cached
   * instance can never recover. OPFS-backed (downloaded) entries stay.
   */
  evictStreamingCharts(): void;
  /**
   * Reload OPFS charts into the PMTiles protocol (dropping entries for
   * deleted charts so their regions fall back to streaming) and re-derive
   * the stored basemap/raster/imported-chart lists + basemap coverage.
   * Failures are logged to the app error log, never thrown.
   */
  reloadOfflineCharts(deps?: ReloadOfflineChartsDeps): Promise<void>;
}

export function createOfflineChartRegistry(
  protocol: Protocol,
): OfflineChartRegistry {
  // Track which protocol entries are backed by OPFS files. A deleted chart's
  // entry must be REMOVED from the protocol — a stale entry serves an
  // OPFSSource over a deleted File (whose slice() rejects), so the region
  // renders blank until reload. With the key absent, the protocol auto-creates
  // a streaming FetchSource from the key URL — the correct fallback.
  const offlineProtocolKeys = new Set<string>();
  async function registerOfflineChart(filename: string): Promise<void> {
    const file = await getChartFile(filename);
    if (!file) {
      // Listed in chart metadata but the OPFS file is gone/unreadable — the
      // region silently streams instead, so leave a trace in diagnostics.
      appErrorLog.log(
        "chart-load",
        "error",
        `stored chart missing from OPFS: ${filename} (falling back to streaming)`,
      );
      return;
    }
    const key = `${chartAssetBase()}/${filename}`;
    protocol.add(new PMTiles(new OPFSSource(file, key)));
    offlineProtocolKeys.add(key);
  }
  function evictStreamingCharts(): void {
    for (const key of protocol.tiles.keys()) {
      if (!offlineProtocolKeys.has(key)) protocol.tiles.delete(key);
    }
  }
  function pruneOfflineCharts(currentFilenames: string[]): void {
    const current = new Set(
      currentFilenames.map((f) => `${chartAssetBase()}/${f}`),
    );
    for (const key of offlineProtocolKeys) {
      if (!current.has(key)) {
        protocol.tiles.delete(key); // next request streams from the key URL
        offlineProtocolKeys.delete(key);
      }
    }
  }

  async function reloadOfflineCharts(
    deps: ReloadOfflineChartsDeps = {},
  ): Promise<void> {
    try {
      const charts = await listStoredCharts();
      pruneOfflineCharts(charts.map((c) => c.filename));
      for (const chart of charts) {
        await registerOfflineChart(chart.filename);
      }
      setStoredBasemaps(
        basemapRegionsFromFilenames(charts.map((c) => c.filename)),
      );
      setStoredRasterCharts(
        rasterChartsFromFilenames(charts.map((c) => c.filename)),
      );
      setImportedRasterCharts(await deriveImportedRasterCharts(charts));
      await loadBasemapCoverage(getSettings().activeRegion);
      await deps.afterReload?.();
    } catch (err) {
      // OPFS not available or unreadable — charts fall back to streaming. Not
      // fatal, but a user with downloaded charts and no internet sees a blank
      // chart with no other clue, so record why.
      appErrorLog.log(
        "chart-load",
        "error",
        `offline chart reload failed: ${formatErrorDetail(err)}`,
      );
      console.warn("[chart-load] offline chart reload failed:", err);
    }
  }

  return {
    hasOfflineCharts: () => offlineProtocolKeys.size > 0,
    evictStreamingCharts,
    reloadOfflineCharts,
  };
}
