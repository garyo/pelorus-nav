/**
 * Chart mode state machine: follow, course-up, north-up, free.
 * Manages automatic map centering/rotation based on vessel position.
 */

import type maplibregl from "maplibre-gl";
import type { SmoothedCourse } from "../navigation/CourseSmoothing";
import type { NavigationData } from "../navigation/NavigationData";
import type { ChartMode as ChartModeType } from "../settings";
import { getSettings, updateSettings } from "../settings";

export class ChartModeController {
  private readonly map: maplibregl.Map;
  private mode: ChartModeType;
  /** The last non-free mode, so recenter can restore it. */
  private modeBeforeFree: ChartModeType = "north-up";
  private lastData: NavigationData | null = null;
  private lastSmoothed: SmoothedCourse | null = null;
  /** True while mouse/touch is down — suppresses jumpTo so drag can start. */
  private userInteracting = false;

  constructor(map: maplibregl.Map) {
    this.map = map;
    this.mode = getSettings().chartMode;
    if (this.mode !== "free") {
      this.modeBeforeFree = this.mode;
    }

    // Detect user-initiated pan/zoom → switch to free mode
    this.map.on("movestart", (e) => {
      if (
        this.mode !== "free" &&
        (e as maplibregl.MapMouseEvent).originalEvent
      ) {
        this.modeBeforeFree = this.mode;
        this.setMode("free");
      }
    });

    // Suppress jumpTo while user is interacting so drag gestures
    // aren't cancelled by GPS-tick map updates.
    // Press is captured on the canvas; release listens on window so that
    // touchcancel (Android system gestures), pointercancel, mouseup-outside
    // the canvas, and focus loss can never leave the flag stuck true.
    const canvas = this.map.getCanvas();
    const setInteracting = () => {
      this.userInteracting = true;
    };
    const clearInteracting = () => {
      this.userInteracting = false;
    };
    canvas.addEventListener("pointerdown", setInteracting);
    if (typeof window !== "undefined") {
      window.addEventListener("pointerup", clearInteracting);
      window.addEventListener("pointercancel", clearInteracting);
      window.addEventListener("touchend", clearInteracting);
      window.addEventListener("touchcancel", clearInteracting);
      window.addEventListener("blur", clearInteracting);
    }
  }

  getMode(): ChartModeType {
    return this.mode;
  }

  /** Restore the previous non-free mode (used by recenter button). */
  recenter(): void {
    this.setMode(this.modeBeforeFree);
  }

  setMode(mode: ChartModeType): void {
    this.mode = mode;
    if (mode !== "free") {
      this.modeBeforeFree = mode;
    }
    updateSettings({ chartMode: mode });

    // When switching to north-up, reset bearing
    if (mode === "north-up" && this.map.getBearing() !== 0) {
      this.map.jumpTo({ bearing: 0 });
    }

    // Apply current position if available
    if (this.lastData && mode !== "free") {
      this.applyPosition(this.lastData);
    }
  }

  update(data: NavigationData, smoothed?: SmoothedCourse | null): void {
    this.lastData = data;
    if (smoothed !== undefined) {
      this.lastSmoothed = smoothed;
    }
    if (this.mode !== "free" && !this.userInteracting) {
      this.applyPosition(data);
    }
  }

  private applyPosition(data: NavigationData): void {
    const s = this.lastSmoothed;
    const center: [number, number] = s
      ? [s.lon, s.lat]
      : [data.longitude, data.latitude];

    switch (this.mode) {
      case "follow":
        this.map.jumpTo({ center });
        break;
      case "course-up": {
        const bearing = s?.cog ?? data.heading ?? data.cog ?? 0;
        this.map.jumpTo({ center, bearing });
        break;
      }
      case "north-up":
        this.map.jumpTo({ center, bearing: 0 });
        break;
    }
  }
}
