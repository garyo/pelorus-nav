/**
 * Compact speed-over-time strip chart for the track viewer.
 *
 * Canvas-rendered, DPR-aware, decimated to one max-value per pixel column
 * so multi-day tracks draw instantly at any width. Stopped intervals are
 * shaded. A vertical cursor tracks the scrub position; dragging on the
 * chart scrubs (two-way sync with the slider).
 *
 * The x-axis matches the scrub domain: elapsed time when the track has
 * timestamps, distance otherwise.
 */

import type { StopInterval, TrackAnalysis } from "../data/track-analysis";
import { getSettings } from "../settings";
import { convertSpeed, speedUnitLabel } from "../utils/units";

const FALLBACK_HEIGHT = 64; // CSS px — real height comes from the stylesheet

interface Palette {
  line: string;
  fill: string;
  stop: string;
  grid: string;
  text: string;
  cursor: string;
  range: string;
}

function palette(): Palette {
  switch (getSettings().displayTheme) {
    case "night":
      return {
        line: "#cc3333",
        fill: "rgba(204,51,51,0.25)",
        stop: "rgba(136,51,51,0.25)",
        grid: "rgba(204,51,51,0.2)",
        text: "#883333",
        cursor: "#ee5555",
        range: "rgba(204,51,51,0.18)",
      };
    case "eink":
      return {
        line: "#000000",
        fill: "rgba(0,0,0,0.15)",
        stop: "rgba(0,0,0,0.25)",
        grid: "rgba(0,0,0,0.3)",
        text: "#000000",
        cursor: "#000000",
        range: "rgba(0,0,0,0.12)",
      };
    default:
      return {
        line: "#6ab0ee",
        fill: "rgba(68,136,204,0.35)",
        stop: "rgba(255,255,255,0.13)",
        grid: "rgba(255,255,255,0.15)",
        text: "#99a",
        cursor: "#ffffff",
        range: "rgba(255,255,255,0.16)",
      };
  }
}

/** Hold roughly still this long to start a range selection. */
const HOLD_MS = 350;
/** Movement beyond this (px) before the hold fires commits to scrubbing. */
const HOLD_SLOP_PX = 6;

export interface ChartCallbacks {
  /** Scrub (tap or drag): move the cursor; clears any range selection. */
  onScrub: (frac: number) => void;
  /** Press-and-hold drag: a range is being selected (fractions unordered). */
  onRange: (fracA: number, fracB: number) => void;
}

export class SpeedProfileChart {
  readonly el: HTMLCanvasElement;
  private readonly callbacks: ChartCallbacks;
  private analysis: TrackAnalysis | null = null;
  private stops: StopInterval[] = [];
  private cursorFrac = 0;
  private range: [number, number] | null = null;
  private readonly resizeObserver: ResizeObserver;

  constructor(callbacks: ChartCallbacks) {
    this.callbacks = callbacks;
    this.el = document.createElement("canvas");
    this.el.className = "track-viewer-chart";
    this.el.title =
      "Drag to scrub · press and hold, then drag to measure a span";

    // Tap/drag scrubs; press-and-hold then drag selects a range.
    let pointerDown = false;
    let downX = 0;
    let anchorFrac = 0;
    let selecting = false;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    const fracFromEvent = (e: PointerEvent) => {
      const rect = this.el.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      return Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    };
    this.el.addEventListener("pointerdown", (e) => {
      this.el.setPointerCapture(e.pointerId);
      pointerDown = true;
      selecting = false;
      downX = e.clientX;
      anchorFrac = fracFromEvent(e);
      this.callbacks.onScrub(anchorFrac);
      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (!pointerDown) return;
        selecting = true;
        this.setRange(anchorFrac, anchorFrac);
        this.callbacks.onRange(anchorFrac, anchorFrac);
      }, HOLD_MS);
    });
    this.el.addEventListener("pointermove", (e) => {
      if (!pointerDown) return;
      const frac = fracFromEvent(e);
      if (selecting) {
        this.setRange(anchorFrac, frac);
        this.callbacks.onRange(anchorFrac, frac);
        return;
      }
      // Moving before the hold fires means scrubbing, not selecting
      if (holdTimer && Math.abs(e.clientX - downX) > HOLD_SLOP_PX) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      this.callbacks.onScrub(frac);
    });
    const end = () => {
      pointerDown = false;
      selecting = false;
      if (holdTimer) clearTimeout(holdTimer);
      holdTimer = null;
    };
    this.el.addEventListener("pointerup", end);
    this.el.addEventListener("pointercancel", end);

    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(this.el);
  }

  /** Show (or clear) the selected-range highlight. */
  setRange(fracA: number | null, fracB = 0): void {
    this.range =
      fracA === null ? null : [Math.min(fracA, fracB), Math.max(fracA, fracB)];
    this.draw();
  }

  setData(analysis: TrackAnalysis, stops: StopInterval[]): void {
    this.analysis = analysis;
    this.stops = stops;
    this.draw();
  }

  setCursor(frac: number): void {
    this.cursorFrac = frac;
    this.draw();
  }

  /** Fraction (0–1) along the scrub domain for point index i. */
  private fracAt(i: number): number {
    const a = this.analysis;
    if (!a) return 0;
    if (a.hasTime) {
      return a.durationMs > 0 ? (a.times[i] - a.startTime) / a.durationMs : 0;
    }
    return a.totalNM > 0 ? a.cumulativeNM[i] / a.totalNM : 0;
  }

  private draw(): void {
    const a = this.analysis;
    const cssW = this.el.clientWidth;
    if (!a || cssW <= 0) return;
    const cssH = this.el.clientHeight || FALLBACK_HEIGHT;
    const dpr = window.devicePixelRatio || 1;
    if (
      this.el.width !== Math.round(cssW * dpr) ||
      this.el.height !== Math.round(cssH * dpr)
    ) {
      this.el.width = Math.round(cssW * dpr);
      this.el.height = Math.round(cssH * dpr);
    }
    const ctx = this.el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const pal = palette();
    const { speedUnit } = getSettings();
    const maxSpeed = convertSpeed(a.maxSpeedKn, speedUnit) * 1.08 || 1;
    const yFor = (kn: number) =>
      cssH - (convertSpeed(kn, speedUnit) / maxSpeed) * cssH;

    // Stopped intervals — shade before the curve so the area reads on top
    ctx.fillStyle = pal.stop;
    for (const s of this.stops) {
      const x0 = this.fracAt(s.startIndex) * cssW;
      const x1 = this.fracAt(s.endIndex) * cssW;
      ctx.fillRect(x0, 0, Math.max(x1 - x0, 1), cssH);
    }

    // Decimate: per-pixel-column maximum
    const n = a.points.length;
    const colMax = new Float64Array(cssW).fill(Number.NaN);
    for (let i = 0; i < n; i++) {
      const col = Math.min(cssW - 1, Math.floor(this.fracAt(i) * cssW));
      const v = a.speedsKn[i];
      if (Number.isNaN(colMax[col]) || v > colMax[col]) colMax[col] = v;
    }

    // Filled area + line through the column maxima
    ctx.beginPath();
    ctx.moveTo(0, cssH);
    let last = 0;
    for (let x = 0; x < cssW; x++) {
      if (!Number.isNaN(colMax[x])) last = colMax[x];
      ctx.lineTo(x, yFor(last));
    }
    ctx.lineTo(cssW - 1, cssH);
    ctx.closePath();
    ctx.fillStyle = pal.fill;
    ctx.fill();

    ctx.beginPath();
    last = 0;
    for (let x = 0; x < cssW; x++) {
      if (!Number.isNaN(colMax[x])) last = colMax[x];
      const y = yFor(last);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = pal.line;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Gridline + label at a round half of the speed range
    const half = maxSpeed / 2;
    const gy = cssH - (half / maxSpeed) * cssH;
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(cssW, gy);
    ctx.stroke();
    ctx.fillStyle = pal.text;
    ctx.font = "9px system-ui, sans-serif";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      `${half.toFixed(half < 10 ? 1 : 0)} ${speedUnitLabel(speedUnit)}`,
      3,
      gy - 1,
    );

    // Selected range — translucent band with edge lines
    if (this.range) {
      const [f0, f1] = this.range;
      const x0 = f0 * cssW;
      const x1 = f1 * cssW;
      ctx.fillStyle = pal.range;
      ctx.fillRect(x0, 0, Math.max(x1 - x0, 1), cssH);
      ctx.strokeStyle = pal.cursor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0, cssH);
      ctx.moveTo(x1, 0);
      ctx.lineTo(x1, cssH);
      ctx.stroke();
    }

    // Scrub cursor
    const cx = this.cursorFrac * cssW;
    ctx.strokeStyle = pal.cursor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, cssH);
    ctx.stroke();
  }
}
