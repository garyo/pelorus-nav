/**
 * Always-visible crew-overboard button (MapLibre IControl, bottom-right).
 *
 * Idle: press-and-hold 1.5 s to activate — an SVG ring fills while held,
 * releasing early cancels and briefly shows a "hold" hint. On e-ink the ring
 * moves in four discrete jumps with a numeric countdown instead of smooth
 * animation. Active: the button pulses and a plain tap toggles the COB panel.
 */

import type * as maplibregl from "maplibre-gl";
import { getSettings } from "../settings";
import { iconLifeRing, setIcon } from "../ui/icons";
import { attachHoldGesture } from "./hold-gesture";

const HOLD_MS = 1500;
const HINT_MS = 2000;
const RING_R = 22;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R;

export interface CobButtonOptions {
  /** Hold completed — mark crew overboard. */
  onActivate(): void;
  /** Tap while a COB event is active — toggle the info panel. */
  onToggleWhileActive(): void;
  isActive(): boolean;
}

export class CobButton implements maplibregl.IControl {
  private container: HTMLDivElement | null = null;
  private button: HTMLButtonElement | null = null;
  private ring: SVGCircleElement | null = null;
  private countEl: HTMLSpanElement | null = null;
  private hintEl: HTMLDivElement | null = null;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private detachHold: (() => void) | null = null;
  private readonly opts: CobButtonOptions;

  constructor(opts: CobButtonOptions) {
    this.opts = opts;
  }

  onAdd(): HTMLElement {
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl cob-ctrl";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "cob-btn";
    button.setAttribute("aria-label", "Hold to mark crew overboard");
    button.title = "Hold 1.5 s to mark crew overboard";
    this.button = button;

    // Progress ring (SVG stroke, JS-driven so it works without CSS animation)
    const svgNS = "http://www.w3.org/2000/svg";
    const ringSvg = document.createElementNS(svgNS, "svg");
    ringSvg.setAttribute("class", "cob-ring");
    ringSvg.setAttribute("viewBox", "0 0 48 48");
    ringSvg.setAttribute("aria-hidden", "true");
    const ring = document.createElementNS(svgNS, "circle");
    ring.setAttribute("cx", "24");
    ring.setAttribute("cy", "24");
    ring.setAttribute("r", String(RING_R));
    ring.setAttribute("stroke-dasharray", String(RING_CIRCUMFERENCE));
    ring.setAttribute("stroke-dashoffset", String(RING_CIRCUMFERENCE));
    ringSvg.appendChild(ring);
    this.ring = ring;

    const iconWrap = document.createElement("span");
    iconWrap.className = "cob-btn-icon";
    setIcon(iconWrap, iconLifeRing);

    const label = document.createElement("span");
    label.className = "cob-btn-label";
    label.textContent = "COB";

    this.countEl = document.createElement("span");
    this.countEl.className = "cob-hold-count";

    button.append(ringSvg, iconWrap, label, this.countEl);

    this.hintEl = document.createElement("div");
    this.hintEl.className = "cob-hint";
    this.hintEl.textContent = "Hold 1.5 s to mark COB";

    this.container.append(this.hintEl, button);

    this.detachHold = attachHoldGesture(button, {
      holdMs: HOLD_MS,
      stepped: () => getSettings().displayTheme === "eink",
      onProgress: (frac) => this.renderProgress(frac),
      onComplete: () => {
        this.renderProgress(0);
        if (this.opts.isActive()) {
          // Holding while already active just opens the panel — never a
          // second event, and definitely not an accidental cancel.
          this.opts.onToggleWhileActive();
        } else {
          this.opts.onActivate();
        }
        this.refresh();
      },
      onCancel: () => {
        this.renderProgress(0);
        if (this.opts.isActive()) {
          this.opts.onToggleWhileActive();
        } else {
          this.showHint();
        }
      },
    });

    this.refresh();
    return this.container;
  }

  onRemove(): void {
    this.detachHold?.();
    this.detachHold = null;
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.container?.remove();
    this.container = null;
    this.button = null;
    this.ring = null;
    this.countEl = null;
    this.hintEl = null;
  }

  /** Sync the active-emergency styling with manager state. */
  refresh(): void {
    if (!this.button) return;
    const active = this.opts.isActive();
    this.button.classList.toggle("cob-active", active);
    const label = active
      ? "Crew overboard active — tap for details"
      : "Hold 1.5 s to mark crew overboard";
    this.button.setAttribute("aria-label", label);
    this.button.title = label;
  }

  private renderProgress(frac: number): void {
    this.ring?.setAttribute(
      "stroke-dashoffset",
      String(RING_CIRCUMFERENCE * (1 - frac)),
    );
    this.button?.classList.toggle("cob-holding", frac > 0);
    if (this.countEl) {
      // E-ink countdown: 4…1 remaining steps; hidden (empty) when not holding.
      this.countEl.textContent =
        frac > 0 && frac < 1
          ? String(Math.max(1, Math.ceil((1 - frac) * 4)))
          : "";
    }
  }

  private showHint(): void {
    if (!this.hintEl) return;
    this.hintEl.classList.add("visible");
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => {
      this.hintEl?.classList.remove("visible");
    }, HINT_MS);
  }
}
