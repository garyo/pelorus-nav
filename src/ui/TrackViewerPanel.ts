/**
 * Track viewer: a bottom panel for scrubbing through a recorded track.
 *
 * Shows the track's headline stats and a speed legend, plus a time slider
 * that drives a cursor on the map (via TrackViewerLayer) with live
 * readouts: time of day, SOG, COG, and distance run.
 *
 * Owns the "track-view" interaction mode: opening enters it, closing
 * returns to "query".
 */

import { getTrackPoints } from "../data/db";
import type { TrackMeta } from "../data/Track";
import {
  analyzeTrack,
  cursorAtFraction,
  speedToColor,
  type TrackAnalysis,
  type TrackCursor,
} from "../data/track-analysis";
import { setMode } from "../map/InteractionMode";
import type { TrackViewerLayer } from "../map/TrackViewerLayer";
import { getSettings } from "../settings";
import { formatDistanceShort, formatDurationShort } from "../utils/format";
import { formatBearing } from "../utils/magnetic";
import { convertSpeed, speedUnitLabel } from "../utils/units";
import { iconX, setIcon } from "./icons";

const SLIDER_MAX = 1000;

export interface TrackViewerHooks {
  /** Called when the viewer opens (e.g. switch chart mode to free). */
  onOpen?: () => void;
  /** Called when the viewer closes. */
  onClose?: () => void;
}

export class TrackViewerPanel {
  private readonly el: HTMLDivElement;
  private readonly layer: TrackViewerLayer;
  private readonly hooks: TrackViewerHooks;
  private readonly nameEl: HTMLSpanElement;
  private readonly statsEl: HTMLSpanElement;
  private readonly legendMinEl: HTMLSpanElement;
  private readonly legendMaxEl: HTMLSpanElement;
  private readonly rampEl: HTMLDivElement;
  private readonly slider: HTMLInputElement;
  private readonly readouts: Record<string, HTMLSpanElement>;
  private analysis: TrackAnalysis | null = null;

  constructor(layer: TrackViewerLayer, hooks: TrackViewerHooks = {}) {
    this.layer = layer;
    this.hooks = hooks;

    this.el = document.createElement("div");
    this.el.className = "track-viewer-panel";
    this.el.innerHTML =
      '<div class="track-viewer-header">' +
      '<span class="track-viewer-name"></span>' +
      '<span class="track-viewer-stats"></span>' +
      '<button class="manager-close"></button>' +
      "</div>" +
      '<div class="track-viewer-legend">' +
      '<span class="track-viewer-legend-min"></span>' +
      '<div class="track-viewer-ramp"></div>' +
      '<span class="track-viewer-legend-max"></span>' +
      "</div>" +
      `<input type="range" class="track-viewer-slider" min="0" max="${SLIDER_MAX}" value="0">` +
      '<div class="track-viewer-readouts">' +
      '<span data-ro="time"></span>' +
      '<span data-ro="sog"></span>' +
      '<span data-ro="cog"></span>' +
      '<span data-ro="dist"></span>' +
      "</div>";
    document.body.appendChild(this.el);

    this.nameEl = this.q(".track-viewer-name");
    this.statsEl = this.q(".track-viewer-stats");
    this.legendMinEl = this.q(".track-viewer-legend-min");
    this.legendMaxEl = this.q(".track-viewer-legend-max");
    this.rampEl = this.q(".track-viewer-ramp");
    this.slider = this.q(".track-viewer-slider");
    this.readouts = Object.fromEntries(
      Array.from(this.el.querySelectorAll<HTMLSpanElement>("[data-ro]")).map(
        (s) => [s.dataset.ro as string, s],
      ),
    );

    const closeBtn = this.q<HTMLButtonElement>(".manager-close");
    setIcon(closeBtn, iconX);
    closeBtn.addEventListener("click", () => this.close());

    this.slider.addEventListener("input", () => {
      this.scrubTo(Number(this.slider.value) / SLIDER_MAX);
    });
  }

  private q<T extends HTMLElement = HTMLSpanElement>(sel: string): T {
    return this.el.querySelector(sel) as T;
  }

  isOpen(): boolean {
    return this.el.classList.contains("open");
  }

  /** Load, analyze, and start viewing a track. */
  async open(meta: TrackMeta): Promise<void> {
    const points = await getTrackPoints(meta.id);
    const analysis = analyzeTrack(points);
    if (!analysis) return; // nothing viewable

    this.analysis = analysis;
    this.nameEl.textContent = meta.name;
    this.statsEl.textContent = this.formatStats(analysis);
    this.renderLegend(analysis);

    this.layer.show(analysis);
    this.slider.value = "0";
    this.scrubTo(0);

    setMode("track-view");
    this.el.classList.add("open");
    this.hooks.onOpen?.();
  }

  close(): void {
    if (!this.isOpen()) return;
    this.el.classList.remove("open");
    this.analysis = null;
    this.layer.hide();
    setMode("query");
    this.hooks.onClose?.();
  }

  /** Alias so the idle-detector can close the viewer like other panels. */
  hide(): void {
    this.close();
  }

  private scrubTo(frac: number): void {
    const a = this.analysis;
    if (!a) return;
    const c = cursorAtFraction(a, frac);
    this.layer.setCursor(c);
    this.updateReadouts(a, c);
  }

  private updateReadouts(a: TrackAnalysis, c: TrackCursor): void {
    const { speedUnit, bearingMode } = getSettings();
    this.readouts.time.textContent = a.hasTime
      ? new Date(c.timestamp).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : "--:--";
    const speed = convertSpeed(c.sogKn, speedUnit);
    this.readouts.sog.textContent = `${speed.toFixed(1)} ${speedUnitLabel(speedUnit)}`;
    this.readouts.cog.textContent = formatBearing(
      c.cogDeg,
      bearingMode,
      c.lat,
      c.lon,
    );
    this.readouts.dist.textContent = formatDistanceShort(c.distanceNM);
  }

  private formatStats(a: TrackAnalysis): string {
    const { speedUnit } = getSettings();
    const unit = speedUnitLabel(speedUnit);
    const parts = [formatDistanceShort(a.totalNM)];
    if (a.hasTime) {
      parts.push(formatDurationShort(a.durationMs));
      parts.push(
        `avg ${convertSpeed(a.avgSpeedKn, speedUnit).toFixed(1)} ${unit}`,
      );
    }
    parts.push(
      `max ${convertSpeed(a.maxSpeedKn, speedUnit).toFixed(1)} ${unit}`,
    );
    return parts.join(" · ");
  }

  private renderLegend(a: TrackAnalysis): void {
    const { speedUnit } = getSettings();
    const unit = speedUnitLabel(speedUnit);
    const colors: string[] = [];
    for (let i = 0; i <= 8; i++) {
      const kn = a.rampMinKn + ((a.rampMaxKn - a.rampMinKn) * i) / 8;
      colors.push(speedToColor(kn, a.rampMinKn, a.rampMaxKn));
    }
    this.rampEl.style.background = `linear-gradient(to right, ${colors.join(",")})`;
    this.legendMinEl.textContent = `${convertSpeed(a.rampMinKn, speedUnit).toFixed(1)}`;
    this.legendMaxEl.textContent = `${convertSpeed(a.rampMaxKn, speedUnit).toFixed(1)} ${unit}`;
  }
}
