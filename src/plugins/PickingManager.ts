/**
 * Central click dispatcher for map feature picking.
 *
 * Owns the single map `click` handler. On a click (in query mode) it runs the
 * registered pickers in descending priority and lets the first that handles
 * the click win, dismissing the rest — guaranteeing one popup at a time across
 * the core chart picker and every plugin overlay. Plugin overlays sit above
 * the chart in z-order and register with higher priority, so they win ties.
 */

import type maplibregl from "maplibre-gl";
import { getMode } from "../map/InteractionMode";
import type { MapPicker } from "./types";

export class PickingManager {
  private readonly pickers: MapPicker[] = [];

  constructor(map: maplibregl.Map) {
    map.on("click", (e: maplibregl.MapMouseEvent) => this.handle(e));
  }

  register(picker: MapPicker): void {
    this.pickers.push(picker);
  }

  /** Dismiss every picker's popup/highlight (e.g. on idle auto-return). */
  hideAll(): void {
    for (const p of this.pickers) p.dismiss();
  }

  private handle(e: maplibregl.MapMouseEvent): void {
    if (getMode() !== "query") return;
    const ordered = [...this.pickers].sort((a, b) => b.priority - a.priority);
    for (const picker of ordered) {
      if (picker.tryPick(e)) {
        for (const other of ordered) {
          if (other !== picker) other.dismiss();
        }
        return;
      }
    }
    // Nothing hit — clear any lingering popups.
    for (const picker of ordered) picker.dismiss();
  }
}

/** Priority bands. Higher is checked first (topmost wins). */
export const PICK_PRIORITY = {
  chart: 0,
  overlay: 100,
} as const;
