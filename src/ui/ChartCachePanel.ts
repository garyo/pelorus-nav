/**
 * Panel for managing chart regions and offline downloads.
 *
 * Shows available regions from the catalog. Each region can be:
 * - Streamed remotely (default, no download needed)
 * - Downloaded to OPFS for offline use
 *
 * The active region is switched via settings.activeRegion.
 */

import { CHART_REGIONS, type ChartRegion } from "../data/chart-catalog";
import { chartAssetBase } from "../data/remote-url";
import type { StoredChartInfo } from "../data/tile-store";
import {
  deleteAllCharts,
  deleteAuxFile,
  deleteChart,
  downloadAuxFile,
  downloadChart,
  getStorageEstimate,
  importChart,
  listStoredCharts,
} from "../data/tile-store";
import { getSettings, updateSettings } from "../settings";
import {
  iconCloudOff,
  iconDownload,
  iconTrash,
  iconUpload,
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

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "manager-panel chart-cache-panel";
    this.el.innerHTML =
      '<div class="manager-header">' +
      "<span>Chart Regions</span>" +
      '<button class="manager-close"></button>' +
      "</div>" +
      '<div class="manager-body"></div>' +
      '<div class="chart-cache-footer"></div>';
    getPanelStack().appendChild(this.el);

    this.body = this.el.querySelector(".manager-body") as HTMLDivElement;
    this.storageInfo = this.el.querySelector(
      ".chart-cache-footer",
    ) as HTMLDivElement;

    const closeBtn = this.el.querySelector(".manager-close") as HTMLElement;
    setIcon(closeBtn, iconX);
    closeBtn.addEventListener("click", () => this.hide());
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

  private async refresh(): Promise<void> {
    const storedCharts = await listStoredCharts();
    const storedMap = new Map(storedCharts.map((c) => [c.filename, c]));
    const activeRegion = getSettings().activeRegion;

    this.body.innerHTML = "";

    // Region list — one row per catalog region
    for (const region of CHART_REGIONS) {
      const stored = storedMap.get(region.filename);
      this.body.appendChild(
        this.createRegionItem(
          region,
          stored ?? null,
          region.id === activeRegion,
        ),
      );
    }

    // Any downloaded files not in catalog (e.g. manually imported)
    for (const chart of storedCharts) {
      if (!CHART_REGIONS.some((r) => r.filename === chart.filename)) {
        this.body.appendChild(this.createImportedItem(chart));
      }
    }

    // Action buttons
    const actions = document.createElement("div");
    actions.className = "chart-cache-actions";

    // Import button
    const importBtn = document.createElement("button");
    importBtn.className = "chart-cache-btn chart-cache-btn--secondary";
    importBtn.innerHTML = `${iconUpload} Load from File...`;
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
  }

  /** Create a row for a catalog region. */
  private createRegionItem(
    region: ChartRegion,
    stored: StoredChartInfo | null,
    isActive: boolean,
  ): HTMLDivElement {
    const item = document.createElement("div");
    item.className = `manager-item${isActive ? " manager-item--active" : ""}`;

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
      detail.innerHTML = `${iconCloudOff} Offline \u00b7 ${formatBytes(stored.sizeBytes)} \u00b7 ${date}`;
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
          await deleteAuxFile(region.filename.replace(".pmtiles", ".search.json"));
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
      const searchFilename = region.filename.replace(".pmtiles", ".search.json");
      try {
        await downloadAuxFile(
          `${chartAssetBase()}/${searchFilename}`,
          searchFilename,
          this.downloadController.signal,
        );
      } catch {
        // Search index may not exist yet for this region — not critical
      }
      this.onChartsChanged?.();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User cancelled
      } else {
        const errorDiv = document.createElement("div");
        errorDiv.className = "chart-cache-error";
        errorDiv.textContent = `Download failed: ${err instanceof Error ? err.message : "Unknown error"}`;
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
