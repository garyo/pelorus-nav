/**
 * MapLibre IControl: chart-mode toggle in the bottom-left corner.
 *
 * Replaces the old single-purpose recenter button. The icon reflects the
 * current chart mode and tapping cycles through them:
 *   free → (recenter to last non-free mode)
 *   follow → course-up
 *   course-up → north-up
 *   north-up → follow
 */

import type maplibregl from "maplibre-gl";
import type { ChartMode } from "../settings";
import {
  iconChartFollow,
  iconCourseUp,
  iconCrosshair,
  iconNorthUp,
  setIcon,
} from "./icons";

export interface ChartModeButtonOptions {
  getMode: () => ChartMode;
  /** Restore the most recent non-free mode (used when leaving free). */
  recenter: () => void;
  setMode: (mode: ChartMode) => void;
}

const FOLLOW_CYCLE: Record<
  Exclude<ChartMode, "free">,
  Exclude<ChartMode, "free">
> = {
  follow: "course-up",
  "course-up": "north-up",
  "north-up": "follow",
};

const ICON_FOR_MODE: Record<ChartMode, string> = {
  free: iconCrosshair,
  follow: iconChartFollow,
  "course-up": iconCourseUp,
  "north-up": iconNorthUp,
};

const LABEL_FOR_MODE: Record<ChartMode, string> = {
  free: "Lock onto vessel",
  follow: "Following vessel (tap for course-up)",
  "course-up": "Course-up (tap for north-up)",
  "north-up": "North-up (tap for follow)",
};

export class RecenterButton implements maplibregl.IControl {
  private container: HTMLDivElement | null = null;
  private button: HTMLButtonElement | null = null;
  private readonly opts: ChartModeButtonOptions;
  private enabled = true;

  constructor(opts: ChartModeButtonOptions) {
    this.opts = opts;
  }

  onAdd(): HTMLElement {
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "recenter-btn";
    button.addEventListener("click", () => {
      if (!this.enabled) return;
      const mode = this.opts.getMode();
      if (mode === "free") {
        this.opts.recenter();
      } else {
        this.opts.setMode(FOLLOW_CYCLE[mode]);
      }
    });
    this.button = button;

    this.container.appendChild(button);
    this.refresh();
    this.setEnabled(this.enabled);
    return this.container;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = null;
    this.button = null;
  }

  /** Update icon + tooltip to match the current mode. */
  refresh(): void {
    if (!this.button) return;
    const mode = this.opts.getMode();
    setIcon(this.button, ICON_FOR_MODE[mode]);
    const label =
      this.enabled || mode !== "free"
        ? LABEL_FOR_MODE[mode]
        : "Lock onto vessel (no GPS fix)";
    this.button.setAttribute("aria-label", label);
    this.button.title = label;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.button) {
      // Only the "free → recenter" transition needs GPS; mode cycling
      // can happen any time, so keep the button clickable in follow modes.
      this.button.disabled = !enabled && this.opts.getMode() === "free";
      this.refresh();
    }
  }
}
