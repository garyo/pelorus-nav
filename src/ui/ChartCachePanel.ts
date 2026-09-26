/**
 * Panel for managing chart regions and offline downloads.
 *
 * Shows available regions from the catalog. Each region can be:
 * - Streamed remotely (default, no download needed)
 * - Downloaded to OPFS for offline use
 *
 * The active region is switched via settings.activeRegion.
 */

import { isCatalogFilename } from "../chart/imported-charts";
import { availableRasterCharts } from "../chart/raster-charts";
import { UNIFIED_COVERAGE_FILENAME } from "../chart/VectorChartProvider";
import {
  CHART_REGIONS,
  type ChartRegion,
  type RasterChart,
} from "../data/chart-catalog";
import { isTransientDownloadError } from "../data/download-resume";
import { chartAssetBase } from "../data/remote-url";
import type { StoredChartInfo } from "../data/tile-store";
import {
  deleteAllCharts,
  deleteAuxFile,
  deleteChart,
  discardPartialDownload,
  downloadAuxFile,
  downloadChart,
  fetchRemoteChartMeta,
  getStorageEstimate,
  importChart,
  isUpdateAvailable,
  listStoredCharts,
  partialDownloadBytes,
} from "../data/tile-store";
import {
  type DownloadPanelState,
  type DownloadQueueItem,
  formatDownloadDone,
  formatDownloadStart,
  formatProgress,
} from "../diagnostics/downloadReport";
import { getSettings, onSettingsChange, updateSettings } from "../settings";
import { diag } from "../utils/diag";
import { formatBytes, formatDurationShort } from "../utils/format";
import {
  iconCheckCircle,
  iconCrosshair,
  iconDownload,
  iconEye,
  iconEyeOff,
  iconFolderOpen,
  iconInfo,
  iconRefresh,
  iconTrash,
  iconX,
  setIcon,
} from "./icons";
import { getPanelStack } from "./PanelStack";
import { registerSurface } from "./SurfaceManager";

/** A downloadable chart file plus its aux files. */
interface DownloadJob {
  /** The primary stored file — identifies the job in the download queue. */
  filename: string;
  label: string;
  /** Catalog estimate, for the queue's remaining-size readout and storage check. */
  sizeEstimate: number;
  run: (ctx: DownloadContext) => Promise<void>;
}

/** A job waiting in, or being served by, the panel's download queue. */
interface QueueEntry {
  job: DownloadJob;
  controller: AbortController;
  active: boolean;
  /** Failed transiently and waiting to retry (see waitForRetry). */
  waiting: boolean;
  /** Transient failures so far that count toward RETRY_DELAYS_MS. */
  attempts: number;
  /** Runs started, including those that failed while the app was hidden. */
  runs: number;
  loaded: number;
  total: number;
  /** Caption override while a job fetches its aux files. */
  status: string | null;
}

/**
 * Backoff before each automatic retry of a transient failure (a network
 * drop or stall); its length bounds the retries before the failure sticks.
 */
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000];

interface DownloadContext {
  signal: AbortSignal;
  onProgress: (loaded: number, total: number) => void;
  /** Replace the progress caption, e.g. while fetching a region's aux files. */
  setStatus: (text: string) => void;
}

/** Fetch an aux file whose absence is tolerable; a user cancel still propagates. */
async function downloadOptionalAux(
  filename: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    await downloadAuxFile(`${chartAssetBase()}/${filename}`, filename, signal);
  } catch (err) {
    if (signal.aborted) throw err;
  }
}

export class ChartCachePanel {
  private readonly el: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly storageInfo: HTMLDivElement;
  /** Downloads in order; the head entry is the one in flight once running. */
  private readonly queue: QueueEntry[] = [];
  private queueRunning = false;
  /** Ends the queue's wait for a retry early; set only while it waits. */
  private wakeQueue: (() => void) | null = null;
  /** Last failure per file, shown in its row until retried or the panel closes. */
  private readonly failures = new Map<string, string>();
  /** Live readouts rebound on every render: the active row's bar and the header. */
  private activeProgress: { fill: HTMLElement; stats: HTMLElement } | null =
    null;
  private queueReadout: HTMLElement | null = null;
  private readonly fileInput: HTMLInputElement;
  private onChartsChanged?: () => void | Promise<void>;
  private onShowChart?: (chart: RasterChart) => void;
  private onRegionSelected?: (region: ChartRegion) => void;
  /** Bumped on each refresh so stale async update-checks are ignored. */
  private refreshToken = 0;
  /** Out-of-date downloads found by the last update check, keyed by filename. */
  private readonly pendingUpdates = new Map<string, DownloadJob>();

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

    this.fileInput = this.buildFileInput();

    // Re-render when the active region changes externally (RegionAutoSwitch,
    // other UI) — rows capture isActive at render time and go stale otherwise.
    let lastActiveRegion = getSettings().activeRegion;
    onSettingsChange((s) => {
      if (s.activeRegion !== lastActiveRegion) {
        lastActiveRegion = s.activeRegion;
        if (this.el.classList.contains("open")) {
          this.refresh().catch(console.error);
        }
      }
    });
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
  setOnChartsChanged(cb: () => void | Promise<void>): void {
    this.onChartsChanged = cb;
  }

  setOnShowChart(cb: (chart: RasterChart) => void): void {
    this.onShowChart = cb;
  }

  /** Called on a MANUAL region selection (not auto-switch) — the map flyTo
   * that follows is deliberate navigation and should exit follow mode. */
  setOnRegionSelected(cb: (region: ChartRegion) => void): void {
    this.onRegionSelected = cb;
  }

  private readonly surface = registerSurface({
    id: "chart-cache",
    slot: "top-right",
    group: "charts",
    // A workspace like the other manager panels — and a download may be in
    // flight (isBusy). Outside taps don't dismiss it; X, Escape, eviction do.
    closeOnOutsideClick: false,
    el: () => this.el,
    isOpen: () => this.el.classList.contains("open"),
    close: () => this.hide(),
  });

  toggle(): void {
    if (this.el.classList.contains("open")) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    this.el.classList.add("open");
    this.surface.opened();
    this.refresh();
  }

  hide(): void {
    this.el.classList.remove("open");
    this.failures.clear();
  }

  /** True while downloads are queued or in flight — idle auto-return must not hide the panel mid-download. */
  isBusy(): boolean {
    return this.queue.length > 0;
  }

  /** The download queue, in the order it will be served. */
  queueState(): DownloadQueueItem[] {
    return this.queue.map((e) => ({
      filename: e.job.filename,
      state: e.active ? "downloading" : e.waiting ? "waiting" : "queued",
      attempts: e.attempts,
      runs: e.runs,
      loaded: e.loaded,
      total: e.total,
    }));
  }

  downloadState(): DownloadPanelState {
    return {
      queue: this.queueState(),
      failures: [...this.failures].map(([filename, message]) => ({
        filename,
        message,
      })),
      pendingUpdates: this.refreshToken > 0 ? this.pendingUpdates.size : null,
    };
  }

  private async refresh(): Promise<void> {
    const token = ++this.refreshToken;
    const storedCharts = await listStoredCharts();
    if (token !== this.refreshToken) return; // superseded while reading
    const storedMap = new Map(storedCharts.map((c) => [c.filename, c]));
    const activeRegion = getSettings().activeRegion;

    this.body.innerHTML = "";
    this.pendingUpdates.clear();
    this.activeProgress = null;
    this.queueReadout = null;

    if (this.queue.length > 0) this.body.appendChild(this.createQueueHeader());

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
    const rasterCharts = availableRasterCharts();
    for (const chart of rasterCharts) {
      this.body.appendChild(
        this.createRasterChartItem(
          chart,
          storedMap.get(chart.filename) ?? null,
        ),
      );
    }

    // Any downloaded files neither in the catalog nor rendered as an imported
    // raster chart (e.g. a vector import, which the map can't style)
    for (const chart of storedCharts) {
      const known =
        isCatalogFilename(chart.filename) ||
        rasterCharts.some((rc) => rc.filename === chart.filename);
      if (!known) {
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

    // Flush all button (only if any charts stored, and none arriving)
    if (storedCharts.length > 0 && this.queue.length === 0) {
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
    const check = (filename: string, onUpdate: () => void): void => {
      const info = storedByFile.get(filename);
      if (!info) return;
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
      check(region.filename, () =>
        this.markUpdateAvailable(
          `[data-region-id="${region.id}"]`,
          `Update ${region.name} to the latest charts`,
          this.regionJob(region),
        ),
      );
      const basemap = region.basemapFilename;
      if (basemap) {
        check(basemap, () =>
          this.markUpdateAvailable(
            `[data-basemap-id="${region.id}"]`,
            `Update ${region.name} basemap`,
            this.basemapJob(region, basemap),
          ),
        );
      }
    }
  }

  /**
   * Flag a downloaded row as having an update: a badge, a per-row update
   * button, and a place in the "Update All" queue at the top of the list.
   */
  private markUpdateAvailable(
    rowSelector: string,
    title: string,
    job: DownloadJob,
  ): void {
    const item = this.body.querySelector<HTMLElement>(rowSelector);
    if (!item || item.querySelector(".chart-region-update")) return;
    if (this.queueEntry(job.filename)) return; // already on its way

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
      updateBtn.title = title;
      updateBtn.addEventListener("click", () => {
        void this.enqueue([job]);
      });
      actions.prepend(updateBtn);
    }

    this.pendingUpdates.set(job.filename, job);
    this.renderUpdateAll();
  }

  /** Keep an "N updates available · Update All" row at the top of the list. */
  private renderUpdateAll(): void {
    let row = this.body.querySelector<HTMLElement>(".chart-cache-update-all");
    if (!row) {
      row = document.createElement("div");
      row.className = "chart-cache-update-all";
      const text = document.createElement("span");
      text.className = "chart-cache-update-all-text";
      const btn = document.createElement("button");
      btn.className = "chart-cache-btn";
      btn.innerHTML = `${iconRefresh} Update All`;
      btn.addEventListener("click", () => {
        void this.enqueue(this.pendingUpdateJobs());
      });
      row.append(text, btn);
      // Below the queue header when downloads are running, else on top
      const header = this.body.querySelector(".chart-cache-queue");
      this.body.insertBefore(row, header?.nextSibling ?? this.body.firstChild);
    }
    const n = this.pendingUpdates.size;
    const text = row.querySelector(".chart-cache-update-all-text");
    if (text) text.textContent = `${n} update${n === 1 ? "" : "s"} available`;
  }

  /** Pending updates in catalog order (HEAD replies arrive in any order). */
  private pendingUpdateJobs(): DownloadJob[] {
    const jobs: DownloadJob[] = [];
    for (const region of CHART_REGIONS) {
      for (const filename of [region.filename, region.basemapFilename]) {
        const job = filename && this.pendingUpdates.get(filename);
        if (job) jobs.push(job);
      }
    }
    return jobs;
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
        this.onRegionSelected?.(region);
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
    const entry = this.queueEntry(region.filename);
    if (entry) {
      this.renderQueuedDetail(detail, entry);
    } else if (stored) {
      const date = new Date(stored.downloadedAt).toLocaleDateString();
      detail.innerHTML = `${iconCheckCircle} Downloaded \u00b7 ${formatBytes(stored.sizeBytes)} \u00b7 ${date}`;
    } else {
      detail.textContent = `Streaming \u00b7 ~${formatBytes(region.sizeEstimate)}`;
    }
    this.applyFailure(detail, region.filename);

    info.append(name, detail);

    const actions = document.createElement("div");
    actions.className = "manager-item-actions";

    if (entry) {
      actions.appendChild(this.createCancelButton(entry));
    } else if (stored) {
      // Delete offline copy
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "manager-item-btn";
      setIcon(deleteBtn, iconTrash);
      deleteBtn.title = "Remove offline copy";
      deleteBtn.addEventListener("click", () => {
        if (!confirm(`Remove offline copy of "${region.name}"?`)) return;
        (async () => {
          try {
            await deleteChart(stored.filename);
            await deleteAuxFile(region.coverageFilename);
            await deleteAuxFile(
              region.filename.replace(".pmtiles", ".search.json"),
            );
            await this.onChartsChanged?.();
          } finally {
            // Whatever happened above, never leave a stale row on screen
            await this.refresh();
          }
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
        void this.enqueue([this.regionJob(region)]);
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
    const filename = region.basemapFilename ?? "";
    const entry = this.queueEntry(filename);
    if (entry) {
      this.renderQueuedDetail(detail, entry);
    } else if (stored) {
      const date = new Date(stored.downloadedAt).toLocaleDateString();
      detail.innerHTML = `${iconCheckCircle} Downloaded · ${formatBytes(stored.sizeBytes)} · ${date}`;
    } else {
      const label =
        getSettings().streetUnderlay === "off"
          ? "Underlay off"
          : "Streaming (OSM)";
      detail.textContent = `${label} · ~${formatBytes(region.basemapSizeEstimate ?? 0)}`;
    }
    this.applyFailure(detail, filename);

    info.append(name, detail);

    const actions = document.createElement("div");
    actions.className = "manager-item-actions";

    if (entry) {
      actions.appendChild(this.createCancelButton(entry));
    } else if (stored) {
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "manager-item-btn";
      setIcon(deleteBtn, iconTrash);
      deleteBtn.title = "Remove offline basemap";
      deleteBtn.addEventListener("click", () => {
        if (!confirm(`Remove offline basemap for "${region.name}"?`)) return;
        (async () => {
          try {
            await deleteChart(stored.filename);
            await this.onChartsChanged?.();
          } finally {
            await this.refresh();
          }
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
        if (!filename) return;
        void this.enqueue([this.basemapJob(region, filename)]);
      });
      actions.appendChild(dlBtn);
    }

    item.append(info, actions);
    return item;
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
    const entry = this.queueEntry(chart.filename);
    if (entry) {
      this.renderQueuedDetail(detail, entry);
    } else if (stored) {
      const verb = chart.imported ? "Imported" : "Downloaded";
      const date = new Date(stored.downloadedAt).toLocaleDateString();
      detail.innerHTML = `${iconCheckCircle} ${verb} · ${formatBytes(stored.sizeBytes)} · ${date}`;
    } else {
      detail.textContent = `Streaming · ~${formatBytes(chart.sizeEstimate)}`;
    }
    this.applyFailure(detail, chart.filename);

    info.append(name, detail);

    const actions = document.createElement("div");
    actions.className = "manager-item-actions";

    // Visibility toggle — with several charts imported for the same waters
    // (RNC + satellite, say), pick which one draws.
    const isHidden = getSettings().hiddenRasterCharts.includes(chart.id);
    const eyeBtn = document.createElement("button");
    eyeBtn.className = "manager-item-btn";
    setIcon(eyeBtn, isHidden ? iconEyeOff : iconEye);
    eyeBtn.title = isHidden ? `Show ${chart.name}` : `Hide ${chart.name}`;
    eyeBtn.addEventListener("click", () => {
      const hidden = getSettings().hiddenRasterCharts;
      updateSettings({
        hiddenRasterCharts: isHidden
          ? hidden.filter((id) => id !== chart.id)
          : [...hidden, chart.id],
      });
      this.refresh().catch(console.error);
    });
    actions.appendChild(eyeBtn);

    const showBtn = document.createElement("button");
    showBtn.className = "manager-item-btn";
    setIcon(showBtn, iconCrosshair);
    showBtn.title = `Go to ${chart.name}`;
    showBtn.addEventListener("click", () => this.onShowChart?.(chart));
    actions.appendChild(showBtn);

    if (entry) {
      actions.appendChild(this.createCancelButton(entry));
    } else if (stored) {
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "manager-item-btn";
      setIcon(deleteBtn, iconTrash);
      deleteBtn.title = "Remove offline copy";
      deleteBtn.addEventListener("click", () => {
        if (!confirm(`Remove offline copy of "${chart.name}"?`)) return;
        (async () => {
          try {
            await deleteChart(stored.filename);
            await deleteAuxFile(chart.coverageFilename);
            // Don't let a deleted chart's id linger in the hidden list
            const hidden = getSettings().hiddenRasterCharts;
            if (hidden.includes(chart.id)) {
              updateSettings({
                hiddenRasterCharts: hidden.filter((id) => id !== chart.id),
              });
            }
            await this.onChartsChanged?.();
          } finally {
            await this.refresh();
          }
        })().catch(console.error);
      });
      actions.appendChild(deleteBtn);
    } else {
      const dlBtn = document.createElement("button");
      dlBtn.className = "manager-item-btn";
      setIcon(dlBtn, iconDownload);
      dlBtn.title = "Download for offline use";
      dlBtn.addEventListener("click", () => {
        void this.enqueue([this.rasterJob(chart)]);
      });
      actions.appendChild(dlBtn);
    }

    item.append(info, actions);
    return item;
  }

  /** Region charts plus coverage, search index and the unified coverage. */
  private regionJob(region: ChartRegion): DownloadJob {
    // A retry after an aux file failed must not fetch the charts again.
    let chartsDone = false;
    return {
      filename: region.filename,
      label: region.name,
      sizeEstimate: region.sizeEstimate,
      run: async ({ signal, onProgress, setStatus }) => {
        if (!chartsDone) {
          await downloadChart(
            `${chartAssetBase()}/${region.filename}`,
            region.filename,
            onProgress,
            signal,
          );
          chartsDone = true;
        }
        setStatus(`Downloading ${region.name} coverage...`);
        await downloadAuxFile(
          `${chartAssetBase()}/${region.coverageFilename}`,
          region.coverageFilename,
          signal,
        );
        // Search index — may not exist yet for this region, not critical
        await downloadOptionalAux(
          region.filename.replace(".pmtiles", ".search.json"),
          signal,
        );
        // Always refresh the unified coverage so the no-coverage mask works
        // offshore. It's tiny and represents all regions, not just this one.
        await downloadOptionalAux(UNIFIED_COVERAGE_FILENAME, signal);
      },
    };
  }

  private basemapJob(region: ChartRegion, filename: string): DownloadJob {
    return {
      filename,
      label: `${region.name} basemap`,
      sizeEstimate: region.basemapSizeEstimate ?? 0,
      run: ({ signal, onProgress }) =>
        downloadChart(
          `${chartAssetBase()}/${filename}`,
          filename,
          onProgress,
          signal,
        ),
    };
  }

  private rasterJob(chart: RasterChart): DownloadJob {
    return {
      filename: chart.filename,
      label: chart.name,
      sizeEstimate: chart.sizeEstimate,
      run: async ({ signal, onProgress }) => {
        await downloadChart(
          `${chartAssetBase()}/${chart.filename}`,
          chart.filename,
          onProgress,
          signal,
        );
        // Coverage footprint for the chart-in-use readout; without it
        // quilting falls back to the catalog bbox.
        await downloadOptionalAux(chart.coverageFilename, signal);
      },
    };
  }

  // ---- Download queue -----------------------------------------------------
  // Files download one at a time, in the order they were requested; the list
  // stays live so more can be queued, cancelled or removed meanwhile. Rows
  // render from queue state, so re-renders mid-download (region switch,
  // reopening the panel) keep showing progress. A transient failure sends
  // its job to the back of the queue, which then pauses until a retry is
  // worth trying (see waitForRetry); the retry resumes where it stopped.

  private queueEntry(filename: string): QueueEntry | undefined {
    return this.queue.find((e) => e.job.filename === filename);
  }

  /** Append jobs not already queued and start the queue if idle. */
  private async enqueue(jobs: DownloadJob[]): Promise<void> {
    const fresh = jobs.filter((job) => !this.queueEntry(job.filename));
    if (fresh.length === 0) return;

    const shortfall = await this.storageShortfall(fresh);
    const names = fresh.map((job) => job.filename).join(", ");
    if (shortfall) {
      diag("download", `not queued ${names}: ${shortfall}`);
      for (const job of fresh) this.failures.set(job.filename, shortfall);
      await this.refresh();
      return;
    }

    for (const job of fresh) {
      this.failures.delete(job.filename);
      this.queue.push({
        job,
        controller: new AbortController(),
        active: false,
        waiting: false,
        attempts: 0,
        runs: 0,
        loaded: 0,
        total: 0,
        status: null,
      });
    }
    diag("download", `queued ${names}`);
    await this.refresh();
    this.wakeQueue?.();
    void this.runQueue();
  }

  /**
   * A message when the queue plus these jobs would not fit in free storage,
   * else null. Catches a batch that would fail on its last item after
   * hundreds of megabytes on cellular. Bytes already kept from an interrupted
   * download count as present. Unknown quota (0) skips the check.
   */
  private async storageShortfall(jobs: DownloadJob[]): Promise<string | null> {
    let est: { used: number; quota: number };
    try {
      est = await getStorageEstimate();
    } catch {
      return null;
    }
    if (est.quota <= 0) return null;
    let needed = 0;
    for (const job of [...this.queue.map((e) => e.job), ...jobs]) {
      const kept = await partialDownloadBytes(job.filename);
      needed += Math.max(0, job.sizeEstimate - kept);
    }
    const free = Math.max(0, est.quota - est.used);
    return needed > free
      ? `Not enough storage: needs ~${formatBytes(needed)}, ${formatBytes(free)} free`
      : null;
  }

  private async runQueue(): Promise<void> {
    if (this.queueRunning) return;
    this.queueRunning = true;
    try {
      while (this.queue.length > 0) {
        const entry = this.queue[0];
        entry.active = true;
        entry.waiting = false;
        await this.refresh();
        const retry = await this.runEntry(entry);
        entry.active = false;
        this.removeEntry(entry);
        if (retry) {
          entry.waiting = true;
          this.queue.push(entry);
        }
        await this.refresh();
        if (retry && this.queue.length > 0) {
          await this.waitForRetry(
            RETRY_DELAYS_MS[Math.max(0, entry.attempts - 1)],
          );
        }
      }
    } finally {
      this.queueRunning = false;
    }
  }

  /**
   * Run one job to completion, cancel, or failure. True when it failed
   * transiently and has a retry left; any other failure is recorded for its
   * row. Failures while the app is hidden (where Android cuts the network)
   * don't use up retries.
   */
  private async runEntry(entry: QueueEntry): Promise<boolean> {
    const { job, controller } = entry;
    const log = (message: string): void =>
      diag("download", `${job.filename} ${message}`);
    entry.runs++;
    const startedAt = Date.now();
    // The byte this run's chart download started from, once it has begun.
    const run: { from: number | null } = { from: null };
    const at = (): string =>
      run.from === null
        ? "before any chart data"
        : `at ${formatProgress(entry.loaded, entry.total)}`;
    try {
      await job.run({
        signal: controller.signal,
        onProgress: (loaded, total) => {
          if (run.from === null) {
            run.from = loaded;
            log(
              `start run ${entry.runs}: ${formatDownloadStart(loaded, total)}`,
            );
          }
          entry.loaded = loaded;
          entry.total = total;
          this.paintProgress(entry);
        },
        setStatus: (text) => {
          entry.status = text;
          this.paintProgress(entry);
        },
      });
      const elapsed = Date.now() - startedAt;
      log(
        run.from === null
          ? `done in ${formatDurationShort(elapsed)}`
          : `done: ${formatDownloadDone(entry.loaded, run.from, elapsed)}`,
      );
      await this.onChartsChanged?.();
      return false;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        log(`cancelled ${at()}`);
        return false;
      }
      const name = err instanceof Error ? err.name : "?";
      const msg = err instanceof Error ? err.message : "Unknown error";
      const failed = `failed ${at()}: ${name}: ${msg}`;
      const max = RETRY_DELAYS_MS.length;
      if (isTransientDownloadError(name) && entry.attempts < max) {
        if (document.hidden) {
          log(
            `${failed}; waiting (hidden, not counted: ${entry.attempts}/${max} retries used)`,
          );
        } else {
          entry.attempts++;
          log(`${failed}; waiting, retry ${entry.attempts}/${max}`);
        }
        return true;
      }
      log(`${failed}; gave up`);
      this.failures.set(job.filename, msg);
      return false;
    }
  }

  /**
   * Resolve once a retry is worth trying: the app returns to the
   * foreground, the device reports it is back online, or `delayMs` passes —
   * the last two only while the app is visible, so retries don't fail
   * uselessly in the background. `wakeQueue` ends the wait early (a new
   * download queued, or the queue emptied).
   */
  private waitForRetry(delayMs: number): Promise<void> {
    const since = Date.now();
    return new Promise((resolve) => {
      const done = (reason: string): void => {
        clearTimeout(timer);
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("online", onOnline);
        this.wakeQueue = null;
        diag(
          "download",
          `queue resumed (${reason}) after ${formatDurationShort(Date.now() - since)}`,
        );
        resolve();
      };
      const wakeOn = (reason: string) => (): void => {
        if (!document.hidden) done(reason);
      };
      const onVisible = wakeOn("visible");
      const onOnline = wakeOn("online");
      const timer = setTimeout(wakeOn("backoff"), delayMs);
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("online", onOnline);
      this.wakeQueue = () => done("queue changed");
    });
  }

  private removeEntry(entry: QueueEntry): void {
    const i = this.queue.indexOf(entry);
    if (i >= 0) this.queue.splice(i, 1);
  }

  /**
   * Take a not-yet-running entry out of the queue, discarding any partial
   * download kept for it. (An active one is aborted instead; the write
   * worker deletes its partial.)
   */
  private dropEntry(entry: QueueEntry): void {
    diag("download", `${entry.job.filename} removed from queue`);
    this.removeEntry(entry);
    void discardPartialDownload(entry.job.filename);
    if (this.queue.length === 0) this.wakeQueue?.();
  }

  /** Abort an in-flight entry (the queue moves on) or drop a waiting one. */
  private cancelEntry(entry: QueueEntry): void {
    if (entry.active) {
      entry.controller.abort();
    } else {
      this.dropEntry(entry);
      void this.refresh();
    }
  }

  private cancelAll(): void {
    for (const entry of this.queue.filter((e) => !e.active)) {
      this.dropEntry(entry);
    }
    this.queue.find((e) => e.active)?.controller.abort();
    void this.refresh();
  }

  /** Bytes still to fetch: the active job's remainder plus waiting estimates. */
  private queueRemainingBytes(): number {
    return this.queue.reduce((sum, e) => {
      const active = e.active && e.total > 0;
      return (
        sum + (active ? Math.max(0, e.total - e.loaded) : e.job.sizeEstimate)
      );
    }, 0);
  }

  private queueSummary(): string {
    const n = this.queue.length;
    return `${n} download${n === 1 ? "" : "s"} · ~${formatBytes(this.queueRemainingBytes())} remaining`;
  }

  /** "N downloads · ~X remaining" with Cancel All, above the region list. */
  private createQueueHeader(): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "chart-cache-queue";
    const text = document.createElement("span");
    text.className = "chart-cache-queue-text";
    text.textContent = this.queueSummary();
    this.queueReadout = text;
    const btn = document.createElement("button");
    btn.className = "chart-cache-btn chart-cache-btn--danger";
    btn.textContent = "Cancel All";
    btn.addEventListener("click", () => this.cancelAll());
    row.append(text, btn);
    return row;
  }

  /** A row's detail line while its file is queued or downloading. */
  private renderQueuedDetail(detail: HTMLElement, entry: QueueEntry): void {
    if (entry.waiting) {
      detail.textContent = "Waiting for network…";
      return;
    }
    if (!entry.active) {
      detail.textContent = `Queued · ~${formatBytes(entry.job.sizeEstimate)}`;
      return;
    }
    const bar = document.createElement("div");
    bar.className = "chart-cache-progress-bar";
    const fill = document.createElement("div");
    fill.className = "chart-cache-progress-fill";
    bar.appendChild(fill);
    const stats = document.createElement("span");
    detail.append(bar, stats);
    this.activeProgress = { fill, stats };
    this.paintProgress(entry);
  }

  /** Push the active entry's progress into the row bar and the header. */
  private paintProgress(entry: QueueEntry): void {
    if (!entry.active) return;
    if (this.activeProgress) {
      const { fill, stats } = this.activeProgress;
      const pct = entry.total > 0 ? (entry.loaded / entry.total) * 100 : 0;
      fill.style.width = `${pct}%`;
      stats.textContent =
        entry.status ??
        `Downloading · ${formatBytes(entry.loaded)} / ${entry.total > 0 ? formatBytes(entry.total) : "?"}`;
    }
    if (this.queueReadout) this.queueReadout.textContent = this.queueSummary();
  }

  private createCancelButton(entry: QueueEntry): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "manager-item-btn chart-region-cancel";
    setIcon(btn, iconX);
    btn.title = entry.active ? "Cancel download" : "Remove from queue";
    btn.addEventListener("click", () => this.cancelEntry(entry));
    return btn;
  }

  /** Annotate a row with its last failed download, if any. */
  private applyFailure(detail: HTMLElement, filename: string): void {
    const failure = this.failures.get(filename);
    if (!failure) return;
    detail.classList.add("manager-item-detail--error");
    detail.textContent = `Download failed: ${failure}`;
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
        try {
          await deleteChart(chart.filename);
          await this.onChartsChanged?.();
        } finally {
          await this.refresh();
        }
      })().catch(console.error);
    });

    actions.appendChild(deleteBtn);
    item.append(info, actions);
    return item;
  }

  /** Persistent hidden input (built in the constructor) — programmatic click
   * on a detached input is flaky on some WebViews, and a DOM-resident input
   * is scriptable in tests without opening the native chooser. */
  private buildFileInput(): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pmtiles";
    input.className = "chart-cache-file-input";
    input.style.display = "none";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      input.value = ""; // allow re-importing the same filename later
      try {
        await importChart(file);
        await this.onChartsChanged?.();
        await this.refresh();
      } catch (err) {
        console.error("Import failed:", err);
      }
    });
    this.el.appendChild(input);
    return input;
  }

  private importFile(): void {
    this.fileInput.click();
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
    await this.onChartsChanged?.();
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
