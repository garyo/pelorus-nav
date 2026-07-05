/**
 * Panel for managing chart regions and offline downloads.
 *
 * Shows available regions from the catalog. Each region can be:
 * - Streamed remotely (default, no download needed)
 * - Downloaded to OPFS for offline use
 *
 * The active region is switched via settings.activeRegion.
 */

import { UNIFIED_COVERAGE_FILENAME } from "../chart/VectorChartProvider";
import {
  CHART_REGIONS,
  type ChartRegion,
  RASTER_CHARTS,
  type RasterChart,
} from "../data/chart-catalog";
import { chartAssetBase } from "../data/remote-url";
import type { StoredChartInfo } from "../data/tile-store";
import {
  deleteAllCharts,
  deleteAuxFile,
  deleteChart,
  downloadAuxFile,
  downloadChart,
  fetchRemoteChartMeta,
  getStorageEstimate,
  importChart,
  isUpdateAvailable,
  listStoredCharts,
} from "../data/tile-store";
import { getSettings, updateSettings } from "../settings";
import { diag } from "../utils/diag";
import {
  iconCheckCircle,
  iconDownload,
  iconFolderOpen,
  iconInfo,
  iconRefresh,
  iconTrash,
  iconX,
  setIcon,
} from "./icons";
import { getPanelStack } from "./PanelStack";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export class ChartCachePanel {
  private readonly el: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly storageInfo: HTMLDivElement;
  private downloadController: AbortController | null = null;
  private onChartsChanged?: () => void;
  /** Bumped on each refresh so stale async update-checks are ignored. */
  private refreshToken = 0;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "manager-panel chart-cache-panel";
    this.el.innerHTML =
      '<div class="manager-header">' +
      "<span>Chart Regions</span>" +
      '<button class="manager-info" title="About offline charts & basemaps"></button>' +
      '<button class="manager-close"></button>' +
      "</div>" +
      '<div class="manager-body"></div>' +
      '<div class="chart-cache-footer"></div>';
    getPanelStack().appendChild(this.el);

    this.body = this.el.querySelector(".manager-body") as HTMLDivElement;
    this.storageInfo = this.el.querySelector(
      ".chart-cache-footer",
    ) as HTMLDivElement;

    const infoBtn = this.el.querySelector(".manager-info") as HTMLElement;
    setIcon(infoBtn, iconInfo);
    infoBtn.addEventListener("click", () => this.showInfo());

    const closeBtn = this.el.querySelector(".manager-close") as HTMLElement;
    setIcon(closeBtn, iconX);
    closeBtn.addEventListener("click", () => this.hide());
  }

  /** Lazily-built "About offline charts & basemaps" info overlay. */
  private infoOverlay: HTMLDivElement | null = null;

  private showInfo(): void {
    if (!this.infoOverlay) this.infoOverlay = this.buildInfoOverlay();
    this.infoOverlay.style.display = "flex";
  }

  private buildInfoOverlay(): HTMLDivElement {
    const overlay = document.createElement("div");
    overlay.className = "about-overlay";

    const card = document.createElement("div");
    card.className = "about-card";

    const title = document.createElement("div");
    title.className = "about-title";
    title.textContent = "Offline charts & basemaps";

    const sections: { heading: string; body: string }[] = [
      {
        heading: "Streaming vs. offline",
        body: "Each region's nautical charts stream over the network by default. Download a region to store its chart tiles on this device so they work with no connection.",
      },
      {
        heading: "Street basemap",
        body: "The optional street basemap adds roads and place names under the charts. Without a download it streams as online OSM raster tiles; downloading it gives crisper, themed vector maps (day/dusk/night) that also work offline.",
      },
      {
        heading: "Going offline saves battery",
        body: "Once your region's charts and basemap are downloaded, the app runs fully offline. Switch the device to airplane mode while navigating — the chartplotter keeps working from GPS alone, and disabling the cellular/Wi-Fi radios meaningfully extends battery life on a long passage.",
      },
    ];

    card.append(title);
    for (const s of sections) {
      const heading = document.createElement("div");
      heading.className = "about-credits-heading";
      heading.textContent = s.heading;
      const body = document.createElement("div");
      body.className = "about-info-body";
      body.textContent = s.body;
      card.append(heading, body);
    }

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) overlay.style.display = "none";
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && overlay.style.display === "flex") {
        e.preventDefault(); // consumed — the global Escape fallback must not also act
        overlay.style.display = "none";
      }
    });

    return overlay;
  }

  /** Register a callback when charts are added/removed (for reloading PMTiles). */
  setOnChartsChanged(cb: () => void): void {
    this.onChartsChanged = cb;
  }

  toggle(): void {
    if (this.el.classList.contains("open")) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    this.el.classList.add("open");
    this.refresh();
  }

  hide(): void {
    this.el.classList.remove("open");
  }

  /** True while a chart/basemap download is in flight — idle auto-return must not hide the panel mid-download. */
  isBusy(): boolean {
    return this.downloadController !== null;
  }

  private async refresh(): Promise<void> {
    const token = ++this.refreshToken;
    const storedCharts = await listStoredCharts();
    const storedMap = new Map(storedCharts.map((c) => [c.filename, c]));
    const activeRegion = getSettings().activeRegion;

    this.body.innerHTML = "";

    // Region list — one row per catalog region (+ basemap sub-row if built)
    for (const region of CHART_REGIONS) {
      const stored = storedMap.get(region.filename);
      this.body.appendChild(
        this.createRegionItem(
          region,
          stored ?? null,
          region.id === activeRegion,
        ),
      );
      if (region.basemapFilename) {
        this.body.appendChild(
          this.createBasemapItem(
            region,
            storedMap.get(region.basemapFilename) ?? null,
          ),
        );
      }
    }

    // Raster charts (RNC) — fill ENC gaps (e.g. the BVI); auto-quilted
    for (const chart of RASTER_CHARTS) {
      this.body.appendChild(
        this.createRasterChartItem(
          chart,
          storedMap.get(chart.filename) ?? null,
        ),
      );
    }

    // Any downloaded files not in catalog (e.g. manually imported)
    for (const chart of storedCharts) {
      const inCatalog =
        CHART_REGIONS.some(
          (r) =>
            r.filename === chart.filename ||
            r.basemapFilename === chart.filename,
        ) || RASTER_CHARTS.some((rc) => rc.filename === chart.filename);
      if (!inCatalog) {
        this.body.appendChild(this.createImportedItem(chart));
      }
    }

    // Action buttons
    const actions = document.createElement("div");
    actions.className = "chart-cache-actions";

    // Import button
    const importBtn = document.createElement("button");
    importBtn.className = "chart-cache-btn chart-cache-btn--secondary";
    importBtn.innerHTML = `${iconFolderOpen} Load from File...`;
    importBtn.addEventListener("click", () => this.importFile());
    actions.appendChild(importBtn);

    // Flush all button (only if any charts stored)
    if (storedCharts.length > 0) {
      const flushBtn = document.createElement("button");
      flushBtn.className = "chart-cache-btn chart-cache-btn--danger";
      flushBtn.innerHTML = `${iconTrash} Remove All Offline`;
      flushBtn.addEventListener("click", () => this.flushAll());
      actions.appendChild(flushBtn);
    }

    this.body.appendChild(actions);
    await this.updateStorageInfo();

    // Check downloaded regions for newer charts (non-blocking, bandwidth-cheap).
    this.checkForUpdates(token, storedCharts);
  }

  /**
   * HEAD each downloaded region and flag those with a newer remote copy.
   * Runs after render so the list shows immediately; stale checks from a
   * superseded refresh are dropped via the token.
   */
  private checkForUpdates(token: number, stored: StoredChartInfo[]): void {
    const storedByFile = new Map(stored.map((c) => [c.filename, c]));
    const check = (
      filename: string | undefined,
      onUpdate: () => void,
    ): void => {
      const info = filename ? storedByFile.get(filename) : undefined;
      if (!info || !filename) return;
      fetchRemoteChartMeta(`${chartAssetBase()}/${filename}`)
        .then((remote) => {
          if (token !== this.refreshToken) return; // panel re-rendered
          if (remote && isUpdateAvailable(info, remote)) {
            onUpdate();
          }
        })
        .catch(() => {
          // offline / HEAD unsupported — leave the row as-is
        });
    };
    for (const region of CHART_REGIONS) {
      check(region.filename, () => this.markUpdateAvailable(region));
      check(region.basemapFilename, () =>
        this.markBasemapUpdateAvailable(region),
      );
    }
  }

  /** Flag a downloaded region's row as having an update, adding an update button. */
  private markUpdateAvailable(region: ChartRegion): void {
    const item = this.body.querySelector<HTMLElement>(
      `[data-region-id="${region.id}"]`,
    );
    if (!item || item.querySelector(".chart-region-update")) return;

    const detail = item.querySelector<HTMLElement>(".manager-item-detail");
    if (detail) {
      detail.classList.add("manager-item-detail--update");
      const badge = document.createElement("span");
      badge.textContent = "Update available · ";
      detail.prepend(badge);
    }

    const actions = item.querySelector<HTMLElement>(".manager-item-actions");
    if (actions) {
      const updateBtn = document.createElement("button");
      updateBtn.className = "manager-item-btn chart-region-update";
      setIcon(updateBtn, iconRefresh);
      updateBtn.title = `Update ${region.name} to the latest charts`;
      updateBtn.addEventListener("click", () => this.startDownload(region));
      actions.prepend(updateBtn);
    }
  }

  /** Flag a downloaded basemap's row as having an update. */
  private markBasemapUpdateAvailable(region: ChartRegion): void {
    const item = this.body.querySelector<HTMLElement>(
      `[data-basemap-id="${region.id}"]`,
    );
    if (!item || item.querySelector(".chart-region-update")) return;

    const detail = item.querySelector<HTMLElement>(".manager-item-detail");
    if (detail) {
      detail.classList.add("manager-item-detail--update");
      const badge = document.createElement("span");
      badge.textContent = "Update available · ";
      detail.prepend(badge);
    }

    const actions = item.querySelector<HTMLElement>(".manager-item-actions");
    if (actions) {
      const updateBtn = document.createElement("button");
      updateBtn.className = "manager-item-btn chart-region-update";
      setIcon(updateBtn, iconRefresh);
      updateBtn.title = `Update ${region.name} basemap`;
      updateBtn.addEventListener("click", () => {
        this.startBasemapDownload(region);
      });
      actions.prepend(updateBtn);
    }
  }

  /** Create a row for a catalog region. */
  private createRegionItem(
    region: ChartRegion,
    stored: StoredChartInfo | null,
    isActive: boolean,
  ): HTMLDivElement {
    const item = document.createElement("div");
    item.className = `manager-item${isActive ? " manager-item--active" : ""}`;
    item.dataset.regionId = region.id;

    // Radio-style select button
    const radio = document.createElement("div");
    radio.className = `chart-region-radio${isActive ? " active" : ""}`;
    radio.title = isActive ? "Active region" : `Switch to ${region.name}`;
    radio.addEventListener("click", () => {
      if (!isActive) {
        updateSettings({ activeRegion: region.id });
        this.refresh();
      }
    });

    const info = document.createElement("div");
    info.className = "manager-item-info";

    const name = document.createElement("div");
    name.className = "manager-item-name";
    name.textContent = region.name;

    const detail = document.createElement("div");
    detail.className = "manager-item-detail";
    if (stored) {
      const date = new Date(stored.downloadedAt).toLocaleDateString();
      detail.innerHTML = `${iconCheckCircle} Downloaded \u00b7 ${formatBytes(stored.sizeBytes)} \u00b7 ${date}`;
    } else {
      detail.textContent = `Streaming \u00b7 ~${formatBytes(region.sizeEstimate)}`;
    }

    info.append(name, detail);

    const actions = document.createElement("div");
    actions.className = "manager-item-actions";

    if (stored) {
      // Delete offline copy
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "manager-item-btn";
      setIcon(deleteBtn, iconTrash);
      deleteBtn.title = "Remove offline copy";
      deleteBtn.addEventListener("click", () => {
        if (!confirm(`Remove offline copy of "${region.name}"?`)) return;
        (async () => {
          await deleteChart(stored.filename);
          await deleteAuxFile(region.coverageFilename);
          await deleteAuxFile(
            region.filename.replace(".pmtiles", ".search.json"),
          );
          this.onChartsChanged?.();
          await this.refresh();
        })().catch(console.error);
      });
      actions.appendChild(deleteBtn);
    } else {
      // Download for offline
      const dlBtn = document.createElement("button");
      dlBtn.className = "manager-item-btn";
      setIcon(dlBtn, iconDownload);
      dlBtn.title = "Download for offline use";
      dlBtn.addEventListener("click", () => {
        this.startDownload(region);
      });
      actions.appendChild(dlBtn);
    }

    item.append(radio, info, actions);
    return item;
  }

  /** Create the street-basemap sub-row shown under a region that has one. */
  private createBasemapItem(
    region: ChartRegion,
    stored: StoredChartInfo | null,
  ): HTMLDivElement {
    const item = document.createElement("div");
    item.className = "manager-item manager-item--sub";
    item.dataset.basemapId = region.id;

    const info = document.createElement("div");
    info.className = "manager-item-info";

    const name = document.createElement("div");
    name.className = "manager-item-name";
    name.textContent = "Street basemap";

    const detail = document.createElement("div");
    detail.className = "manager-item-detail";
    if (stored) {
      const date = new Date(stored.downloadedAt).toLocaleDateString();
      detail.innerHTML = `${iconCheckCircle} Downloaded · ${formatBytes(stored.sizeBytes)} · ${date}`;
    } else {
      const label =
        getSettings().streetUnderlay === "off"
          ? "Underlay off"
          : "Streaming (OSM)";
      detail.textContent = `${label} · ~${formatBytes(region.basemapSizeEstimate ?? 0)}`;
    }

    info.append(name, detail);

    const actions = document.createElement("div");
    actions.className = "manager-item-actions";

    if (stored) {
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "manager-item-btn";
      setIcon(deleteBtn, iconTrash);
      deleteBtn.title = "Remove offline basemap";
      deleteBtn.addEventListener("click", () => {
        if (!confirm(`Remove offline basemap for "${region.name}"?`)) return;
        (async () => {
          await deleteChart(stored.filename);
          this.onChartsChanged?.();
          await this.refresh();
        })().catch(console.error);
      });
      actions.appendChild(deleteBtn);
    } else {
      const dlBtn = document.createElement("button");
      dlBtn.className = "manager-item-btn";
      setIcon(dlBtn, iconDownload);
      dlBtn.title =
        "Download offline street basemap — crisper themed vector maps that work without a connection. Otherwise streams online OSM raster tiles.";
      dlBtn.addEventListener("click", () => {
        this.startBasemapDownload(region);
      });
      actions.appendChild(dlBtn);
    }

    item.append(info, actions);
    return item;
  }

  private async startBasemapDownload(region: ChartRegion): Promise<void> {
    const filename = region.basemapFilename;
    if (!filename) return;
    await this.downloadWithProgress(
      `${region.name} basemap`,
      `${chartAssetBase()}/${filename}`,
      filename,
    );
  }

  /** Create a row for a raster chart (RNC) — auto-quilted to fill ENC gaps. */
  private createRasterChartItem(
    chart: RasterChart,
    stored: StoredChartInfo | null,
  ): HTMLDivElement {
    const item = document.createElement("div");
    item.className = "manager-item";
    item.dataset.rasterId = chart.id;

    const info = document.createElement("div");
    info.className = "manager-item-info";

    const name = document.createElement("div");
    name.className = "manager-item-name";
    name.textContent = chart.name;

    const detail = document.createElement("div");
    detail.className = "manager-item-detail";
    if (stored) {
      const date = new Date(stored.downloadedAt).toLocaleDateString();
      detail.innerHTML = `${iconCheckCircle} Downloaded · ${formatBytes(stored.sizeBytes)} · ${date}`;
    } else {
      detail.textContent = `Streaming · ~${formatBytes(chart.sizeEstimate)}`;
    }

    info.append(name, detail);

    const actions = document.createElement("div");
    actions.className = "manager-item-actions";

    if (stored) {
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "manager-item-btn";
      setIcon(deleteBtn, iconTrash);
      deleteBtn.title = "Remove offline copy";
      deleteBtn.addEventListener("click", () => {
        if (!confirm(`Remove offline copy of "${chart.name}"?`)) return;
        (async () => {
          await deleteChart(stored.filename);
          await deleteAuxFile(chart.coverageFilename);
          this.onChartsChanged?.();
          await this.refresh();
        })().catch(console.error);
      });
      actions.appendChild(deleteBtn);
    } else {
      const dlBtn = document.createElement("button");
      dlBtn.className = "manager-item-btn";
      setIcon(dlBtn, iconDownload);
      dlBtn.title = "Download for offline use";
      dlBtn.addEventListener("click", () => {
        this.startRasterDownload(chart);
      });
      actions.appendChild(dlBtn);
    }

    item.append(info, actions);
    return item;
  }

  private async startRasterDownload(chart: RasterChart): Promise<void> {
    await this.downloadWithProgress(
      chart.name,
      `${chartAssetBase()}/${chart.filename}`,
      chart.filename,
      async (signal) => {
        // Coverage footprint for the chart-in-use readout (non-fatal if absent).
        try {
          await downloadAuxFile(
            `${chartAssetBase()}/${chart.coverageFilename}`,
            chart.coverageFilename,
            signal,
          );
        } catch {
          // Coverage is optional — quilting falls back to the catalog bbox.
        }
      },
    );
  }

  /** Single-file download with the panel's progress UI, then refresh. */
  private async downloadWithProgress(
    label: string,
    url: string,
    filename: string,
    downloadAux?: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    this.body.innerHTML = "";

    const progressContainer = document.createElement("div");
    progressContainer.className = "chart-cache-progress";

    const labelDiv = document.createElement("div");
    labelDiv.className = "chart-cache-progress-label";
    labelDiv.textContent = `Downloading ${label}...`;

    const barOuter = document.createElement("div");
    barOuter.className = "chart-cache-progress-bar";
    const barInner = document.createElement("div");
    barInner.className = "chart-cache-progress-fill";
    barOuter.appendChild(barInner);

    const stats = document.createElement("div");
    stats.className = "chart-cache-progress-stats";
    stats.textContent = "0 MB / ? MB";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "chart-cache-btn chart-cache-btn--danger";
    cancelBtn.textContent = "Cancel";

    this.downloadController = new AbortController();
    cancelBtn.addEventListener("click", () => {
      this.downloadController?.abort();
    });

    progressContainer.append(labelDiv, barOuter, stats, cancelBtn);
    this.body.appendChild(progressContainer);

    try {
      await downloadChart(
        url,
        filename,
        (loaded, total) => {
          const pct = total > 0 ? (loaded / total) * 100 : 0;
          barInner.style.width = `${pct}%`;
          stats.textContent = `${formatBytes(loaded)} / ${total > 0 ? formatBytes(total) : "?"}`;
        },
        this.downloadController.signal,
      );
      await downloadAux?.(this.downloadController.signal);
      this.onChartsChanged?.();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User cancelled
      } else {
        const msg = err instanceof Error ? err.message : "Unknown error";
        diag(
          "download",
          `${filename} failed: ${err instanceof Error ? err.name : "?"}: ${msg}`,
        );
        const errorDiv = document.createElement("div");
        errorDiv.className = "chart-cache-error";
        errorDiv.textContent = `Download failed: ${msg}`;
        this.body.appendChild(errorDiv);
        return;
      }
    } finally {
      this.downloadController = null;
    }

    await this.refresh();
  }

  /** Create a row for a manually imported file not in the catalog. */
  private createImportedItem(chart: StoredChartInfo): HTMLDivElement {
    const item = document.createElement("div");
    item.className = "manager-item";

    const info = document.createElement("div");
    info.className = "manager-item-info";

    const name = document.createElement("div");
    name.className = "manager-item-name";
    name.textContent = chart.filename;

    const detail = document.createElement("div");
    detail.className = "manager-item-detail";
    const date = new Date(chart.downloadedAt).toLocaleDateString();
    detail.textContent = `Imported \u00b7 ${formatBytes(chart.sizeBytes)} \u00b7 ${date}`;

    info.append(name, detail);

    const actions = document.createElement("div");
    actions.className = "manager-item-actions";

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "manager-item-btn";
    setIcon(deleteBtn, iconTrash);
    deleteBtn.title = "Delete";
    deleteBtn.addEventListener("click", () => {
      if (!confirm(`Delete "${chart.filename}"?`)) return;
      (async () => {
        await deleteChart(chart.filename);
        this.onChartsChanged?.();
        await this.refresh();
      })().catch(console.error);
    });

    actions.appendChild(deleteBtn);
    item.append(info, actions);
    return item;
  }

  private async startDownload(region: ChartRegion): Promise<void> {
    this.body.innerHTML = "";

    const progressContainer = document.createElement("div");
    progressContainer.className = "chart-cache-progress";

    const label = document.createElement("div");
    label.className = "chart-cache-progress-label";
    label.textContent = `Downloading ${region.name}...`;

    const barOuter = document.createElement("div");
    barOuter.className = "chart-cache-progress-bar";
    const barInner = document.createElement("div");
    barInner.className = "chart-cache-progress-fill";
    barOuter.appendChild(barInner);

    const stats = document.createElement("div");
    stats.className = "chart-cache-progress-stats";
    stats.textContent = "0 MB / ? MB";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "chart-cache-btn chart-cache-btn--danger";
    cancelBtn.textContent = "Cancel";

    this.downloadController = new AbortController();
    cancelBtn.addEventListener("click", () => {
      this.downloadController?.abort();
    });

    progressContainer.append(label, barOuter, stats, cancelBtn);
    this.body.appendChild(progressContainer);

    try {
      await downloadChart(
        `${chartAssetBase()}/${region.filename}`,
        region.filename,
        (loaded, total) => {
          const pct = total > 0 ? (loaded / total) * 100 : 0;
          barInner.style.width = `${pct}%`;
          stats.textContent = `${formatBytes(loaded)} / ${total > 0 ? formatBytes(total) : "?"}`;
        },
        this.downloadController.signal,
      );
      // Also download the coverage GeoJSON for offline use
      label.textContent = `Downloading ${region.name} coverage...`;
      await downloadAuxFile(
        `${chartAssetBase()}/${region.coverageFilename}`,
        region.coverageFilename,
        this.downloadController.signal,
      );
      // Download search index (non-fatal if missing)
      const searchFilename = region.filename.replace(
        ".pmtiles",
        ".search.json",
      );
      try {
        await downloadAuxFile(
          `${chartAssetBase()}/${searchFilename}`,
          searchFilename,
          this.downloadController.signal,
        );
      } catch {
        // Search index may not exist yet for this region — not critical
      }
      // Always refresh the unified coverage so the no-coverage mask works
      // offshore. It's tiny and represents all regions, not just this one.
      try {
        await downloadAuxFile(
          `${chartAssetBase()}/${UNIFIED_COVERAGE_FILENAME}`,
          UNIFIED_COVERAGE_FILENAME,
          this.downloadController.signal,
        );
      } catch {
        // Non-fatal: region tiles still work, mask falls back to online fetch
      }
      this.onChartsChanged?.();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User cancelled
      } else {
        const msg = err instanceof Error ? err.message : "Unknown error";
        diag(
          "download",
          `region=${region.id} failed: ${err instanceof Error ? err.name : "?"}: ${msg}`,
        );
        const errorDiv = document.createElement("div");
        errorDiv.className = "chart-cache-error";
        errorDiv.textContent = `Download failed: ${msg}`;
        this.body.appendChild(errorDiv);
        return;
      }
    } finally {
      this.downloadController = null;
    }

    await this.refresh();
  }

  private async importFile(): Promise<void> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pmtiles";

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await importChart(file);
        this.onChartsChanged?.();
        await this.refresh();
      } catch (err) {
        console.error("Import failed:", err);
      }
    });

    input.click();
  }

  private async flushAll(): Promise<void> {
    if (
      !confirm("Remove all offline charts? You will need to re-download them.")
    )
      return;
    await deleteAllCharts();
    // Also remove all coverage GeoJSON and search index files
    for (const region of CHART_REGIONS) {
      await deleteAuxFile(region.coverageFilename);
      await deleteAuxFile(region.filename.replace(".pmtiles", ".search.json"));
    }
    await deleteAuxFile(UNIFIED_COVERAGE_FILENAME);
    this.onChartsChanged?.();
    await this.refresh();
  }

  private async updateStorageInfo(): Promise<void> {
    try {
      const est = await getStorageEstimate();
      if (est.quota > 0) {
        this.storageInfo.textContent = `Storage: ${formatBytes(est.used)} / ${formatBytes(est.quota)} used`;
      } else {
        this.storageInfo.textContent = "";
      }
    } catch {
      this.storageInfo.textContent = "";
    }
  }
}
