/**
 * Floating panel for listing, toggling, renaming, and deleting recorded tracks.
 */

import { deleteTrack, getAllTrackMetas, saveTrackMeta } from "../data/db";
import type { TrackMeta } from "../data/Track";
import type { TrackLayer } from "../map/TrackLayer";
import type { TrackRecorder } from "../map/TrackRecorder";
import { getPanelStack } from "./PanelStack";

export class TrackManagerPanel {
  private readonly el: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly trackLayer: TrackLayer;
  private readonly recorder: TrackRecorder;
  private readonly recordBtn: HTMLButtonElement;

  constructor(trackLayer: TrackLayer, recorder: TrackRecorder) {
    this.trackLayer = trackLayer;
    this.recorder = recorder;

    this.el = document.createElement("div");
    this.el.className = "manager-panel";
    this.el.innerHTML =
      '<div class="manager-header">' +
      "<span>Tracks</span>" +
      '<button class="track-record-btn"></button>' +
      '<button class="manager-close">&times;</button>' +
      "</div>" +
      '<div class="manager-body"></div>';
    getPanelStack().appendChild(this.el);

    this.body = this.el.querySelector(".manager-body") as HTMLDivElement;
    this.recordBtn = this.el.querySelector(
      ".track-record-btn",
    ) as HTMLButtonElement;
    this.updateRecordBtn();

    this.recordBtn.addEventListener("click", () => {
      if (this.recorder.isRecording()) {
        this.recorder.stop();
      } else {
        this.recorder.start();
      }
    });

    this.el
      .querySelector(".manager-close")
      ?.addEventListener("click", () => this.hide());

    recorder.onRecordingChange(() => {
      this.updateRecordBtn();
      this.refresh();
    });
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
  }

  private async refresh(): Promise<void> {
    const metas = await getAllTrackMetas();
    // Sort newest first
    metas.sort((a, b) => b.createdAt - a.createdAt);

    if (metas.length === 0) {
      this.body.innerHTML =
        '<div class="manager-empty">No recorded tracks</div>';
      return;
    }

    this.body.innerHTML = "";
    for (const meta of metas) {
      this.body.appendChild(this.createTrackItem(meta));
    }
  }

  private createTrackItem(meta: TrackMeta): HTMLDivElement {
    const item = document.createElement("div");
    item.className = "manager-item";

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
    name.title = "Click to rename";
    name.addEventListener("click", () => this.rename(meta, name));

    const detail = document.createElement("div");
    detail.className = "manager-item-detail";
    const date = new Date(meta.createdAt).toLocaleDateString();
    detail.textContent = `${date} \u00b7 ${meta.pointCount} pts`;

    info.append(name, detail);

    const actions = document.createElement("div");
    actions.className = "manager-item-actions";

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "manager-item-btn";
    toggleBtn.textContent = meta.visible
      ? "\u{1F441}"
      : "\u{1F441}\u200D\u{1F5E8}";
    toggleBtn.title = meta.visible ? "Hide" : "Show";
    toggleBtn.addEventListener("click", () => {
      (async () => {
        meta.visible = !meta.visible;
        await saveTrackMeta(meta);
        await this.trackLayer.toggleTrackVisibility(meta.id, meta.visible);
        await this.refresh();
      })().catch(console.error);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "manager-item-btn";
    deleteBtn.textContent = "\u{1F5D1}";
    deleteBtn.title = "Delete";
    deleteBtn.addEventListener("click", () => {
      if (!confirm(`Delete track "${meta.name}"?`)) return;
      (async () => {
        await deleteTrack(meta.id);
        await this.trackLayer.reloadAll();
        await this.refresh();
      })().catch(console.error);
    });

    actions.append(toggleBtn, deleteBtn);
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
    input.focus();
    input.select();

    const finish = async () => {
      const newName = input.value.trim() || meta.name;
      meta.name = newName;
      await saveTrackMeta(meta);
      this.refresh();
    };

    input.addEventListener("blur", finish);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") {
        input.value = meta.name;
        input.blur();
      }
    });
  }

  private async pickColor(
    meta: TrackMeta,
    colorEl: HTMLDivElement,
  ): Promise<void> {
    const input = document.createElement("input");
    input.type = "color";
    input.value = meta.color;
    input.style.position = "absolute";
    input.style.opacity = "0";
    colorEl.appendChild(input);
    input.click();

    input.addEventListener("input", () => {
      meta.color = input.value;
      colorEl.style.backgroundColor = input.value;
    });

    input.addEventListener("change", async () => {
      meta.color = input.value;
      await saveTrackMeta(meta);
      await this.trackLayer.reloadAll();
      input.remove();
    });
  }
}
