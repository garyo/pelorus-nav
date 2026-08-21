/**
 * Armed-status corner badge (MapLibre IControl, top-left): visible whenever
 * the anchor watch is armed and no anchor surface is showing — hidden while
 * anchor mode is open (the panel has the detail) and while an alarm banner is
 * up (the banner outranks it). Shows the zone state as colour plus a glyph
 * (so it reads on e-ink and to colour-blind eyes) and the live distance to
 * the anchor; tapping re-enters anchor mode.
 *
 * Top-left is the free corner: bottom-left holds the chart-mode/cancel-nav/
 * COB control stack, bottom-right the nav HUD, top-right the zoom control
 * and the slide-in panel column. The side instrument layout offsets this
 * corner's controls clear of its column (style.css).
 */

import type * as maplibregl from "maplibre-gl";
import { getSettings } from "../settings";
import { iconAnchor, setIcon } from "../ui/icons";
import { formatDistanceNM, NM_TO_METERS } from "../utils/units";
import type { AnchorWatchSnapshot, AnchorZone } from "./AnchorWatchManager";

/** Glyph per zone so the state never relies on colour alone. */
const ZONE_GLYPHS: Record<AnchorZone, string> = {
  ok: "●", // ●
  warn: "▲", // ▲
  outside: "✕", // ✕
  gray: "○", // ○
};

export interface AnchorBadgeOptions {
  /** Tap — re-enter anchor mode for detail/disarm. */
  onTap(): void;
}

export class AnchorBadge implements maplibregl.IControl {
  private container: HTMLDivElement | null = null;
  private button: HTMLButtonElement | null = null;
  private glyphEl: HTMLSpanElement | null = null;
  private distEl: HTMLSpanElement | null = null;
  private snap: AnchorWatchSnapshot | null = null;
  private modeActive = false;
  private readonly opts: AnchorBadgeOptions;

  constructor(opts: AnchorBadgeOptions) {
    this.opts = opts;
  }

  onAdd(): HTMLElement {
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl anchor-badge-ctrl";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "anchor-badge";
    button.setAttribute("aria-label", "Anchor watch — tap for details");
    button.title = "Anchor watch — tap for details";
    setIcon(button, iconAnchor);
    this.glyphEl = document.createElement("span");
    this.glyphEl.className = "anchor-badge-glyph";
    this.distEl = document.createElement("span");
    this.distEl.className = "anchor-badge-dist";
    button.append(this.glyphEl, this.distEl);
    button.addEventListener("click", () => this.opts.onTap());
    this.button = button;

    this.container.appendChild(button);
    this.refresh();
    return this.container;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = null;
    this.button = null;
    this.glyphEl = null;
    this.distEl = null;
  }

  /** Latest watch snapshot (null = disarmed). */
  update(snap: AnchorWatchSnapshot | null): void {
    this.snap = snap;
    this.refresh();
  }

  /** Anchor mode showing its own surfaces — the badge steps aside. */
  setModeActive(active: boolean): void {
    this.modeActive = active;
    this.refresh();
  }

  private refresh(): void {
    const btn = this.button;
    if (!btn || !this.glyphEl || !this.distEl) return;
    const snap = this.snap;
    const visible = snap !== null && !this.modeActive && !snap.alarming;
    btn.style.display = visible ? "" : "none";
    if (!snap || !visible) return;
    btn.dataset.zone = snap.zone;
    this.glyphEl.textContent = ZONE_GLYPHS[snap.zone];
    this.distEl.textContent =
      snap.distanceM !== null
        ? formatDistanceNM(
            snap.distanceM / NM_TO_METERS,
            getSettings().depthUnit,
          )
        : "--";
  }
}
