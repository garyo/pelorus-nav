/**
 * Track viewer: a bottom panel for scrubbing and replaying a recorded track.
 *
 * Shows headline stats (moving time, average-while-moving, maneuvers), a
 * color legend with a mode selector (speed / course / time), a speed
 * profile chart, and a time slider — chart, slider, and the map cursor
 * stay in sync. Playback animates the cursor at a wall-clock multiple.
 *
 * Owns the "track-view" interaction mode: opening enters it, closing
 * returns to "query".
 */

import { getTrackPoints } from "../data/db";
import type { TrackMeta } from "../data/Track";
import {
  analyzeTrack,
  courseToColor,
  cursorAtFraction,
  detectManeuvers,
  detectStops,
  movingStats,
  rampColor,
  speedToColor,
  type TrackAnalysis,
  type TrackColorMode,
  type TrackCursor,
} from "../data/track-analysis";
import { setMode } from "../map/InteractionMode";
import type { TrackViewerLayer } from "../map/TrackViewerLayer";
import { getSettings, updateSettings } from "../settings";
import { formatDistanceShort, formatDurationShort } from "../utils/format";
import { formatBearing } from "../utils/magnetic";
import { convertSpeed, speedUnitLabel } from "../utils/units";
import { iconPause, iconPlay, iconX, setIcon } from "./icons";
import { SpeedProfileChart } from "./SpeedProfileChart";

const SLIDER_MAX = 1000;
const PLAY_RATES = [10, 60, 600] as const;
const DEFAULT_PLAY_RATE = 60;

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
  private readonly colorSelect: HTMLSelectElement;
  private readonly legendMinEl: HTMLSpanElement;
  private readonly legendMaxEl: HTMLSpanElement;
  private readonly rampEl: HTMLDivElement;
  private readonly chart: SpeedProfileChart;
  private readonly slider: HTMLInputElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly rateSelect: HTMLSelectElement;
  private readonly readouts: Record<string, HTMLSpanElement>;
  private analysis: TrackAnalysis | null = null;
  private cursorFrac = 0;
  /** Instruments were on when the viewer opened — restore them on close. */
  private hudWasOn = false;
  private playing = false;
  private playRate = DEFAULT_PLAY_RATE;
  private rafId: number | null = null;
  private lastTickMs: number | null = null;

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
      '<select class="track-viewer-colorby">' +
      '<option value="speed">Speed</option>' +
      '<option value="course">Course</option>' +
      '<option value="time">Time</option>' +
      "</select>" +
      '<span class="track-viewer-legend-min"></span>' +
      '<div class="track-viewer-ramp"></div>' +
      '<span class="track-viewer-legend-max"></span>' +
      "</div>" +
      `<input type="range" class="track-viewer-slider" min="0" max="${SLIDER_MAX}" value="0">` +
      '<div class="track-viewer-controls">' +
      '<button class="track-viewer-play" title="Play"></button>' +
      '<select class="track-viewer-rate" title="Playback speed"></select>' +
      '<span data-ro="time"></span>' +
      '<span data-ro="sog"></span>' +
      '<span data-ro="cog"></span>' +
      '<span data-ro="dist"></span>' +
      "</div>";
    document.body.appendChild(this.el);

    this.nameEl = this.q(".track-viewer-name");
    this.statsEl = this.q(".track-viewer-stats");
    this.colorSelect = this.q<HTMLSelectElement>(".track-viewer-colorby");
    this.legendMinEl = this.q(".track-viewer-legend-min");
    this.legendMaxEl = this.q(".track-viewer-legend-max");
    this.rampEl = this.q<HTMLDivElement>(".track-viewer-ramp");
    this.slider = this.q<HTMLInputElement>(".track-viewer-slider");
    this.playBtn = this.q<HTMLButtonElement>(".track-viewer-play");
    this.rateSelect = this.q<HTMLSelectElement>(".track-viewer-rate");
    this.readouts = Object.fromEntries(
      Array.from(this.el.querySelectorAll<HTMLSpanElement>("[data-ro]")).map(
        (s) => [s.dataset.ro as string, s],
      ),
    );

    // Chart between the legend and the slider, scrubbing both ways
    this.chart = new SpeedProfileChart((frac) => this.setFraction(frac));
    this.slider.before(this.chart.el);

    const closeBtn = this.q<HTMLButtonElement>(".manager-close");
    setIcon(closeBtn, iconX);
    closeBtn.addEventListener("click", () => this.close());

    this.slider.addEventListener("input", () => {
      this.setFraction(Number(this.slider.value) / SLIDER_MAX);
    });

    this.colorSelect.addEventListener("change", () => {
      const mode = this.colorSelect.value as TrackColorMode;
      this.layer.setColorMode(mode);
      if (this.analysis) this.renderLegend(this.analysis, mode);
    });

    setIcon(this.playBtn, iconPlay);
    this.playBtn.addEventListener("click", () => this.togglePlay());
    for (const rate of PLAY_RATES) {
      const opt = document.createElement("option");
      opt.value = String(rate);
      opt.textContent = `${rate}×`;
      this.rateSelect.appendChild(opt);
    }
    this.rateSelect.value = String(DEFAULT_PLAY_RATE);
    this.rateSelect.addEventListener("change", () => {
      this.playRate = Number(this.rateSelect.value);
    });

    // Tapping a maneuver marker on the map jumps the cursor there
    this.layer.onManeuverClick((timestamp) => {
      const a = this.analysis;
      if (!a?.hasTime || a.durationMs <= 0) return;
      this.setFraction((timestamp - a.startTime) / a.durationMs);
    });
  }

  private q<T extends HTMLElement = HTMLSpanElement>(sel: string): T {
    return this.el.querySelector(sel) as T;
  }

  isOpen(): boolean {
    return this.el.classList.contains("open");
  }

  /** True while playback animates — main.ts suppresses auto-return then. */
  isPlaying(): boolean {
    return this.playing;
  }

  /** Load, analyze, and start viewing a track. */
  async open(meta: TrackMeta): Promise<void> {
    const points = await getTrackPoints(meta.id);
    const analysis = analyzeTrack(points);
    if (!analysis) return; // nothing viewable

    this.stopPlayback();
    this.analysis = analysis;
    const stops = detectStops(analysis);
    const maneuvers = detectManeuvers(analysis);

    this.nameEl.textContent = meta.name;
    this.statsEl.textContent = this.formatStats(
      analysis,
      stops,
      maneuvers.length,
    );
    this.colorSelect.value = "speed";
    this.layer.setColorMode("speed");
    this.renderLegend(analysis, "speed");
    this.playBtn.disabled = !analysis.hasTime;
    this.rateSelect.disabled = !analysis.hasTime;

    // Turn the instrument HUD off — live nav readouts are noise while
    // reviewing, and switching the real setting returns its space to the
    // map (which then resizes before the fit below).
    this.hudWasOn = getSettings().showInstrumentHUD;
    if (this.hudWasOn) updateSettings({ showInstrumentHUD: false });

    // Open before sizing the chart (a hidden canvas has no width) and
    // before showing the layer, whose fit pads for the panel's height.
    setMode("track-view");
    this.el.classList.add("open");
    this.chart.setData(analysis, stops);
    this.layer.show(analysis, maneuvers, this.el.offsetHeight);
    this.setFraction(0);
    this.hooks.onOpen?.();
  }

  close(): void {
    if (!this.isOpen()) return;
    this.stopPlayback();
    this.el.classList.remove("open");
    // Restore instruments unless the user re-enabled them mid-view
    if (this.hudWasOn && !getSettings().showInstrumentHUD) {
      updateSettings({ showInstrumentHUD: true });
    }
    this.analysis = null;
    this.layer.hide();
    setMode("query");
    this.hooks.onClose?.();
  }

  /** Alias so the idle-detector can close the viewer like other panels. */
  hide(): void {
    this.close();
  }

  /** Move the scrub cursor — single source of truth for slider/chart/map. */
  private setFraction(frac: number): void {
    const a = this.analysis;
    if (!a) return;
    this.cursorFrac = Math.min(Math.max(frac, 0), 1);
    this.slider.value = String(Math.round(this.cursorFrac * SLIDER_MAX));
    this.chart.setCursor(this.cursorFrac);
    const c = cursorAtFraction(a, this.cursorFrac);
    this.layer.setCursor(c);
    this.updateReadouts(a, c);
  }

  // ── Playback ──────────────────────────────────────────────────────

  private togglePlay(): void {
    if (this.playing) {
      this.stopPlayback();
      return;
    }
    const a = this.analysis;
    if (!a?.hasTime || a.durationMs <= 0) return;
    if (this.cursorFrac >= 1) this.setFraction(0); // replay from the start
    this.playing = true;
    setIcon(this.playBtn, iconPause);
    this.playBtn.title = "Pause";
    this.lastTickMs = null;
    this.rafId = requestAnimationFrame((t) => this.tick(t));
  }

  private stopPlayback(): void {
    this.playing = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    setIcon(this.playBtn, iconPlay);
    this.playBtn.title = "Play";
  }

  private tick(nowMs: number): void {
    const a = this.analysis;
    if (!this.playing || !a) return;
    if (this.lastTickMs !== null) {
      const advanceMs = (nowMs - this.lastTickMs) * this.playRate;
      const frac = this.cursorFrac + advanceMs / a.durationMs;
      if (frac >= 1) {
        this.setFraction(1);
        this.stopPlayback();
        return;
      }
      this.setFraction(frac);
    }
    this.lastTickMs = nowMs;
    this.rafId = requestAnimationFrame((t) => this.tick(t));
  }

  // ── Readouts, stats, legend ───────────────────────────────────────

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

  private formatStats(
    a: TrackAnalysis,
    stops: ReturnType<typeof detectStops>,
    maneuverCount: number,
  ): string {
    const { speedUnit } = getSettings();
    const unit = speedUnitLabel(speedUnit);
    const parts = [formatDistanceShort(a.totalNM)];
    if (a.hasTime) {
      const { movingMs, avgMovingKn } = movingStats(a, stops);
      parts.push(
        stops.length > 0
          ? `${formatDurationShort(movingMs)} moving`
          : formatDurationShort(a.durationMs),
      );
      parts.push(
        `avg ${convertSpeed(avgMovingKn, speedUnit).toFixed(1)} ${unit}`,
      );
    }
    parts.push(
      `max ${convertSpeed(a.maxSpeedKn, speedUnit).toFixed(1)} ${unit}`,
    );
    if (maneuverCount > 0) parts.push(`${maneuverCount} maneuvers`);
    return parts.join(" · ");
  }

  private renderLegend(a: TrackAnalysis, mode: TrackColorMode): void {
    const colors: string[] = [];
    for (let i = 0; i <= 12; i++) {
      const f = i / 12;
      colors.push(
        mode === "speed"
          ? speedToColor(
              a.rampMinKn + (a.rampMaxKn - a.rampMinKn) * f,
              a.rampMinKn,
              a.rampMaxKn,
            )
          : mode === "course"
            ? courseToColor(360 * f)
            : rampColor(f),
      );
    }
    this.rampEl.style.background = `linear-gradient(to right, ${colors.join(",")})`;

    const { speedUnit } = getSettings();
    switch (mode) {
      case "speed":
        this.legendMinEl.textContent = convertSpeed(
          a.rampMinKn,
          speedUnit,
        ).toFixed(1);
        this.legendMaxEl.textContent = `${convertSpeed(a.rampMaxKn, speedUnit).toFixed(1)} ${speedUnitLabel(speedUnit)}`;
        break;
      case "course":
        this.legendMinEl.textContent = "000°";
        this.legendMaxEl.textContent = "360°";
        break;
      case "time": {
        const fmt = (t: number) =>
          a.hasTime
            ? new Date(t).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "";
        this.legendMinEl.textContent = fmt(a.startTime) || "start";
        this.legendMaxEl.textContent = fmt(a.endTime) || "end";
        break;
      }
    }
  }
}
