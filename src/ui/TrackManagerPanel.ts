/**
 * Floating panel for listing, toggling, renaming, and deleting recorded tracks.
 */

import {
  appendTrackPoints,
  deleteTrack,
  getAllTrackMetas,
  getTrackPoints,
  saveTrackMeta,
} from "../data/db";
import {
  downloadFile,
  GPX_MIME,
  pickFile,
  sanitizeFilename,
} from "../data/file-io";
import { exportAllToGpx, parseGpx, trackToGpx } from "../data/gpx";
import {
  computeTrackAggregates,
  isTrivialTrack,
  type TrackMeta,
} from "../data/Track";
import type { TrackLayer } from "../map/TrackLayer";
import type { TrackRecorder } from "../map/TrackRecorder";
import { updateSettings } from "../settings";
import { formatDistanceShort, formatDurationShort } from "../utils/format";
import { openColorPicker } from "./color-picker";
import {
  iconActivity,
  iconExport,
  iconEye,
  iconEyeOff,
  iconFolderOpen,
  iconTrash,
  iconX,
  setIcon,
} from "./icons";
import { getPanelStack } from "./PanelStack";

export class TrackManagerPanel {
  private readonly el: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly trackLayer: TrackLayer;
  private readonly recorder: TrackRecorder;
  private readonly recordBtn: HTMLButtonElement;
  private selectedTrackId: string | null = null;
  /** Track IDs currently being lazy-filled with duration/distance. Stops
   *  duplicate getTrackPoints + saveTrackMeta when refresh() runs again
   *  before a previous fill completes. */
  private readonly fillsInFlight: Set<string> = new Set();
  /** True while an inline rename input is open. Suppresses refresh() so a
   *  background refresh can't destroy the input mid-edit and silently
   *  lose the rename. */
  private editing = false;
  private onViewTrack?: (meta: TrackMeta) => void;

  constructor(trackLayer: TrackLayer, recorder: TrackRecorder) {
    this.trackLayer = trackLayer;
    this.recorder = recorder;

    this.el = document.createElement("div");
    this.el.className = "manager-panel";
    this.el.innerHTML =
      '<div class="manager-header">' +
      "<span>Tracks</span>" +
      '<div style="display:flex;gap:6px;align-items:center">' +
      '<button class="manager-item-btn" id="track-import-btn" title="Import GPX"></button>' +
      '<button class="manager-item-btn" id="track-export-all-btn" title="Export All GPX"></button>' +
      '<button class="manager-item-btn" id="track-delete-all-btn" title="Delete All Tracks"></button>' +
      '<button class="track-record-btn"></button>' +
      '<button class="manager-close"></button>' +
      "</div>" +
      "</div>" +
      '<div class="manager-body"></div>';
    getPanelStack().appendChild(this.el);

    this.body = this.el.querySelector(".manager-body") as HTMLDivElement;
    this.recordBtn = this.el.querySelector(
      ".track-record-btn",
    ) as HTMLButtonElement;
    this.updateRecordBtn();

    this.recordBtn.addEventListener("click", () => {
      // Toggle the persisted setting (not recorder.start/stop directly) so the
      // recording state survives a reload/restart — main.ts resumes recording
      // on launch from trackRecordingEnabled. The settings listener drives the
      // actual start()/stop().
      updateSettings({ trackRecordingEnabled: !this.recorder.isRecording() });
    });

    const importBtn = this.el.querySelector("#track-import-btn") as HTMLElement;
    setIcon(importBtn, iconFolderOpen);
    importBtn.addEventListener("click", () => this.importGpx());

    const exportAllBtn = this.el.querySelector(
      "#track-export-all-btn",
    ) as HTMLElement;
    setIcon(exportAllBtn, iconExport);
    exportAllBtn.addEventListener("click", () => this.exportAll());

    const deleteAllBtn = this.el.querySelector(
      "#track-delete-all-btn",
    ) as HTMLElement;
    setIcon(deleteAllBtn, iconTrash);
    deleteAllBtn.addEventListener("click", () => {
      this.deleteAll().catch(console.error);
    });

    const closeBtn = this.el.querySelector(".manager-close") as HTMLElement;
    if (closeBtn) {
      setIcon(closeBtn, iconX);
      closeBtn.addEventListener("click", () => this.hide());
    }

    recorder.onRecordingChange(() => {
      this.updateRecordBtn();
      this.updateActiveCount();
    });
  }

  /** Register the track-viewer entry point (wired in main.ts). */
  setOnViewTrack(cb: (meta: TrackMeta) => void): void {
    this.onViewTrack = cb;
  }

  private updateRecordBtn(): void {
    const recording = this.recorder.isRecording();
    this.recordBtn.textContent = recording ? "Stop" : "Record";
    this.recordBtn.classList.toggle("recording", recording);
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
    this.clearSelection();
  }

  private clearSelection(): void {
    if (this.selectedTrackId === null) return;
    this.selectedTrackId = null;
    for (const row of this.body.querySelectorAll(".manager-item.selected")) {
      row.classList.remove("selected");
    }
    this.trackLayer.clearSelectedTrack();
  }

  private selectTrack(meta: TrackMeta): void {
    if (this.selectedTrackId === meta.id) {
      this.clearSelection();
      return;
    }
    this.selectedTrackId = meta.id;
    for (const row of this.body.querySelectorAll(".manager-item.selected")) {
      row.classList.remove("selected");
    }
    const row = this.body.querySelector<HTMLElement>(
      `.manager-item[data-track-id="${meta.id}"]`,
    );
    if (row) row.classList.add("selected");

    // Selecting a hidden track makes it visible.
    if (!meta.visible) {
      meta.visible = true;
      (async () => {
        await saveTrackMeta(meta);
        await this.trackLayer.toggleTrackVisibility(meta.id, true);
        await this.trackLayer.selectTrack(meta);
        await this.trackLayer.fitTrack(meta);
        await this.refresh();
      })().catch(console.error);
      return;
    }

    this.trackLayer.selectTrack(meta).catch(console.error);
    this.trackLayer.fitTrack(meta).catch(console.error);
  }

  /** Update just the point count for the active track (no DB hit). */
  private updateActiveCount(): void {
    const track = this.recorder.getCurrentTrack();
    if (!track) {
      // Recording stopped — do a full refresh to update the final state
      this.refresh();
      return;
    }
    const el = this.body.querySelector<HTMLElement>(
      "[data-active-track-detail]",
    );
    if (!el) {
      // Panel hasn't rendered this track yet — full refresh
      this.refresh();
      return;
    }
    el.textContent = formatTrackDetail(track);
  }

  private async refresh(): Promise<void> {
    if (this.editing) return;
    const metas = await getAllTrackMetas();
    // Sort newest first
    metas.sort((a, b) => b.createdAt - a.createdAt);

    // Clean up trivially short tracks where we already know they're
    // trivial without loading points (pointCount<3, or cached aggregates
    // below threshold). Don't touch the currently-recording track.
    const activeId = this.recorder.getCurrentTrack()?.id;
    const visible: TrackMeta[] = [];
    for (const meta of metas) {
      if (meta.id !== activeId && isTrivialTrack(meta)) {
        void this.deleteTrivial(meta);
        continue;
      }
      visible.push(meta);
    }

    if (visible.length === 0) {
      this.body.innerHTML =
        '<div class="manager-empty">No recorded tracks</div>';
      return;
    }

    this.body.innerHTML = "";
    for (const meta of visible) {
      this.body.appendChild(this.createTrackItem(meta));
    }

    // Lazy-fill duration / distance for legacy tracks recorded before
    // these aggregates were cached. Runs in the background; each row
    // refreshes when its values are ready. New tracks already have the
    // fields and skip this path. fillAggregates also re-runs the
    // trivial check once it has real numbers, so a 0-distance 10-point
    // track gets cleaned up there.
    for (const meta of visible) {
      if (meta.durationMs !== undefined && meta.totalDistanceNM !== undefined) {
        continue;
      }
      void this.fillAggregates(meta);
    }
  }

  /** Quietly remove a trivial track from IDB and from the on-disk list. */
  private async deleteTrivial(meta: TrackMeta): Promise<void> {
    try {
      await deleteTrack(meta.id);
      const row = this.body.querySelector<HTMLElement>(
        `[data-track-id="${meta.id}"]`,
      );
      row?.remove();
    } catch (e) {
      console.error("trivial-track cleanup failed", meta.id, e);
    }
  }

  /** Compute + persist + re-render aggregates for a legacy-meta track.
   *  If the freshly-computed aggregates reveal the track is trivial,
   *  delete it instead of saving. */
  private async fillAggregates(meta: TrackMeta): Promise<void> {
    if (this.fillsInFlight.has(meta.id)) return;
    this.fillsInFlight.add(meta.id);
    try {
      const points = await getTrackPoints(meta.id);
      const { durationMs, totalDistanceNM } = computeTrackAggregates(points);
      const updated: TrackMeta = { ...meta, durationMs, totalDistanceNM };
      if (isTrivialTrack(updated)) {
        await this.deleteTrivial(updated);
        return;
      }
      await saveTrackMeta(updated);
      const row = this.body.querySelector<HTMLElement>(
        `[data-track-id="${meta.id}"] .manager-item-detail`,
      );
      if (row) row.textContent = formatTrackDetail(updated);
    } catch (e) {
      console.error("track aggregate fill failed", meta.id, e);
    } finally {
      this.fillsInFlight.delete(meta.id);
    }
  }

  private createTrackItem(meta: TrackMeta): HTMLDivElement {
    const item = document.createElement("div");
    item.className = "manager-item";
    item.dataset.trackId = meta.id;
    if (this.selectedTrackId === meta.id) item.classList.add("selected");

    const color = document.createElement("div");
    color.className = "manager-item-color";
    color.style.backgroundColor = meta.color;
    color.title = "Change color";
    color.addEventListener("click", () => this.pickColor(meta, color));

    const info = document.createElement("div");
    info.className = "manager-item-info";

    const name = document.createElement("div");
    name.className = "manager-item-name";
    name.textContent = meta.name;
    name.title = "Click to select, double-click to rename";
    name.style.cursor = "pointer";
    let clickTimer: ReturnType<typeof setTimeout> | null = null;
    name.addEventListener("click", () => {
      if (clickTimer) return; // second click of a dblclick — ignore
      clickTimer = setTimeout(() => {
        clickTimer = null;
        this.selectTrack(meta);
      }, 250);
    });
    name.addEventListener("dblclick", () => {
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      this.rename(meta, name);
    });

    const detail = document.createElement("div");
    detail.className = "manager-item-detail";
    const activeTrack = this.recorder.getCurrentTrack();
    const isRecording = !!(activeTrack && meta.id === activeTrack.id);
    if (isRecording) {
      detail.dataset.activeTrackDetail = "1";
      item.classList.add("manager-item--recording");
      // Pull live values from the in-memory currentTrack so the row
      // shows the most recent duration / distance even mid-fix.
      detail.textContent = formatTrackDetail(activeTrack);
    } else {
      detail.textContent = formatTrackDetail(meta);
    }

    info.append(name, detail);

    const actions = document.createElement("div");
    actions.className = "manager-item-actions";

    const viewBtn = document.createElement("button");
    viewBtn.className = "manager-item-btn";
    setIcon(viewBtn, iconActivity);
    viewBtn.title = "View track";
    viewBtn.addEventListener("click", () => this.onViewTrack?.(meta));

    const exportBtn = document.createElement("button");
    exportBtn.className = "manager-item-btn";
    setIcon(exportBtn, iconExport);
    exportBtn.title = "Export GPX";
    exportBtn.addEventListener("click", () => {
      (async () => {
        const points = await getTrackPoints(meta.id);
        const gpx = trackToGpx(meta, points);
        downloadFile(gpx, `${sanitizeFilename(meta.name)}.gpx`, GPX_MIME);
      })().catch(console.error);
    });

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "manager-item-btn";
    setIcon(toggleBtn, meta.visible ? iconEye : iconEyeOff);
    toggleBtn.title = meta.visible ? "Hide" : "Show";
    toggleBtn.addEventListener("click", () => {
      (async () => {
        meta.visible = !meta.visible;
        // Hiding a selected track clears selection so the glow doesn't
        // linger without the crisp line under it.
        if (!meta.visible && this.selectedTrackId === meta.id) {
          this.clearSelection();
        }
        await saveTrackMeta(meta);
        await this.trackLayer.toggleTrackVisibility(meta.id, meta.visible);
        await this.refresh();
      })().catch(console.error);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "manager-item-btn";
    setIcon(deleteBtn, iconTrash);
    deleteBtn.title = "Delete";
    deleteBtn.addEventListener("click", () => {
      if (!confirm(`Delete track "${meta.name}"?`)) return;
      (async () => {
        if (this.selectedTrackId === meta.id) this.clearSelection();
        await deleteTrack(meta.id);
        await this.trackLayer.reloadAll();
        await this.refresh();
      })().catch(console.error);
    });

    actions.append(viewBtn, exportBtn, toggleBtn, deleteBtn);
    item.append(color, info, actions);
    return item;
  }

  private async rename(meta: TrackMeta, nameEl: HTMLDivElement): Promise<void> {
    const input = document.createElement("input");
    input.type = "text";
    input.value = meta.name;
    input.className = "map-context-input";
    input.style.margin = "0";
    input.style.width = "100%";
    nameEl.replaceWith(input);
    this.editing = true;
    input.focus();
    input.select();

    const finish = async () => {
      this.editing = false;
      const newName = input.value.trim() || meta.name;
      meta.name = newName;
      await saveTrackMeta(meta);
      this.refresh();
    };

    input.addEventListener("blur", finish);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") {
        e.preventDefault(); // cancel the rename only — not navigation
        input.value = meta.name;
        input.blur();
      }
    });
  }

  private async deleteAll(): Promise<void> {
    // Never delete the actively-recording track out from under the recorder —
    // it would keep appending points to the deleted id and re-save a ghost
    // meta on stop. (refresh()'s trivial-track cleanup makes the same
    // exclusion.)
    const activeId = this.recorder.getCurrentTrack()?.id;
    const metas = (await getAllTrackMetas()).filter((m) => m.id !== activeId);
    if (metas.length === 0) {
      alert(
        activeId
          ? "No tracks to delete (recording in progress is kept)."
          : "No tracks to delete.",
      );
      return;
    }
    const n = metas.length;
    const suffix = activeId ? " The recording in progress is kept." : "";
    if (
      !confirm(
        `Delete all ${n} track${n !== 1 ? "s" : ""}? This cannot be undone.${suffix}`,
      )
    ) {
      return;
    }
    this.clearSelection();
    for (const meta of metas) {
      await deleteTrack(meta.id);
    }
    await this.trackLayer.reloadAll();
    await this.refresh();
  }

  private async exportAll(): Promise<void> {
    const metas = await getAllTrackMetas();
    if (metas.length === 0) {
      alert("No tracks to export.");
      return;
    }
    const tracks = await Promise.all(
      metas.map(async (meta) => ({
        meta,
        points: await getTrackPoints(meta.id),
      })),
    );
    const gpx = exportAllToGpx([], tracks, []);
    downloadFile(gpx, "pelorus-tracks.gpx", GPX_MIME);
  }

  private pickColor(meta: TrackMeta, colorEl: HTMLDivElement): void {
    openColorPicker(
      colorEl,
      meta.color,
      (color) => {
        meta.color = color;
        colorEl.style.backgroundColor = color;
      },
      (color) => {
        meta.color = color;
        (async () => {
          await saveTrackMeta(meta);
          await this.trackLayer.reloadAll();
        })().catch(console.error);
      },
    );
  }

  private async importGpx(): Promise<void> {
    let xml: string;
    try {
      xml = await pickFile(".gpx");
    } catch {
      return; // cancelled
    }

    const result = parseGpx(xml);
    if (result.tracks.length === 0) {
      alert("No tracks found in this GPX file.");
      return;
    }

    // Avoid name conflicts
    const existing = await getAllTrackMetas();
    const existingNames = new Set(existing.map((t) => t.name));

    for (const { meta, points } of result.tracks) {
      if (existingNames.has(meta.name)) {
        meta.name += " (imported)";
      }
      // Sort points by timestamp before saving
      points.sort((a, b) => a.timestamp - b.timestamp);
      await saveTrackMeta(meta);
      await appendTrackPoints(meta.id, points);
    }

    await this.trackLayer.reloadAll();
    await this.refresh();

    const n = result.tracks.length;
    alert(`Imported ${n} track${n !== 1 ? "s" : ""}.`);
  }
}

/** "May 23 · 1h 47m · 12.4 nm" — date, duration, distance separated by
 *  middle dots. Falls back to "…" while aggregates are still being
 *  computed for legacy tracks. */
function formatTrackDetail(meta: TrackMeta): string {
  const date = new Date(meta.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const parts: string[] = [date];
  if (meta.durationMs !== undefined) {
    parts.push(formatDurationShort(meta.durationMs));
  } else {
    parts.push("…");
  }
  if (meta.totalDistanceNM !== undefined) {
    parts.push(formatDistanceShort(meta.totalDistanceNM));
  } else {
    parts.push("…");
  }
  return parts.join(" · ");
}
