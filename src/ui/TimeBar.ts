/**
 * Time bar — a transient bottom-of-screen slider that scrubs the global
 * display-time offset (now → now+48h) so prediction overlays (tides, currents,
 * wind) show future conditions. The vessel/GPS stays at real now.
 *
 * Opened from a top-bar Clock action. Closing it (manually, or via the 60s idle
 * auto-return that recenters on the vessel) resets the offset to now, so the
 * chart never silently lingers on a stale future time. The offset itself lives
 * in the transient `displayTime` store and resets on reload.
 */

import { getSettings } from "../settings";
import {
  getOffsetMs,
  MAX_OFFSET_MS,
  onChange as onOffsetChange,
  setOffsetMs,
} from "../state/displayTime";
import { shortTimeZone } from "../utils/timezone";

const HOUR_MS = 3_600_000;

/** "Now" at zero, else "+Nh" (the slider steps in whole hours). */
function formatOffset(ms: number): string {
  if (ms <= 0) return "Now";
  return `+${Math.round(ms / HOUR_MS)}h`;
}

export class TimeBar {
  private readonly el: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly readout: HTMLElement;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  /** Notified when the bar opens (true) / closes (false) — drives button state. */
  onVisibilityChange: ((open: boolean) => void) | null = null;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "time-bar";
    this.el.style.display = "none";

    const nowBtn = document.createElement("button");
    nowBtn.className = "time-bar-now";
    nowBtn.textContent = "Now";
    nowBtn.title = "Back to current conditions";
    nowBtn.addEventListener("click", () => setOffsetMs(0));

    this.slider = document.createElement("input");
    this.slider.type = "range";
    this.slider.className = "time-bar-slider";
    this.slider.min = "0";
    this.slider.max = String(MAX_OFFSET_MS);
    this.slider.step = String(HOUR_MS);
    this.slider.value = "0";
    // Live label on every input; commit the offset live on normal displays, but
    // only on release (change) for e-ink, which can't repaint fast enough.
    this.slider.addEventListener("input", () => {
      const v = Number(this.slider.value);
      this.renderReadout(v);
      if (getSettings().displayTheme !== "eink") setOffsetMs(v);
    });
    this.slider.addEventListener("change", () => {
      setOffsetMs(Number(this.slider.value));
    });

    this.readout = document.createElement("div");
    this.readout.className = "time-bar-readout";

    const closeBtn = document.createElement("button");
    closeBtn.className = "time-bar-close";
    closeBtn.setAttribute("aria-label", "Close time bar");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => this.hide());

    this.el.append(nowBtn, this.slider, this.readout, closeBtn);
    document.body.appendChild(this.el);

    // Keep slider + readout in sync if the offset changes elsewhere (e.g. the
    // Now button, or a future programmatic set).
    onOffsetChange((ms) => {
      this.slider.value = String(ms);
      this.renderReadout(ms);
    });
  }

  isOpen(): boolean {
    return this.el.style.display !== "none";
  }

  toggle(): void {
    if (this.isOpen()) this.hide();
    else this.show();
  }

  show(): void {
    if (this.isOpen()) return;
    this.slider.value = String(getOffsetMs());
    this.renderReadout(getOffsetMs());
    this.el.style.display = "flex";
    // The absolute time drifts forward with the wall clock; refresh it.
    this.clockTimer = setInterval(
      () => this.renderReadout(getOffsetMs()),
      60_000,
    );
    this.onVisibilityChange?.(true);
  }

  hide(): void {
    if (!this.isOpen()) return;
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clockTimer = null;
    this.el.style.display = "none";
    setOffsetMs(0); // closing returns the chart to live conditions
    this.onVisibilityChange?.(false);
  }

  private renderReadout(ms: number): void {
    const when = new Date(Date.now() + ms);
    const clock = when.toLocaleString([], {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const tz = shortTimeZone();
    this.readout.textContent = `${formatOffset(ms)} · ${clock}${tz ? ` ${tz}` : ""}`;
  }
}
