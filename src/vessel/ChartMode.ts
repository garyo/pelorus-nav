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
  private lastData: NavigationData | null = null;
  private lastSmoothed: SmoothedCourse | null = null;

  constructor(map: maplibregl.Map) {
    this.map = map;
    this.mode = getSettings().chartMode;

    // Detect user-initiated pan/zoom → switch to free mode
    this.map.on("movestart", (e) => {
      // Only user gestures have originalEvent
      if (
        this.mode !== "free" &&
        (e as maplibregl.MapMouseEvent).originalEvent
      ) {
        this.setMode("free");
      }
    });
  }

  getMode(): ChartModeType {
    return this.mode;
  }

  setMode(mode: ChartModeType): void {
    this.mode = mode;
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
    if (this.mode !== "free") {
      this.applyPosition(data);
    }
  }

  private applyPosition(data: NavigationData): void {
    const center: [number, number] = [data.longitude, data.latitude];

    switch (this.mode) {
      case "follow":
        this.map.jumpTo({ center });
        break;
      case "course-up": {
        const bearing = this.lastSmoothed?.cog ?? data.heading ?? data.cog ?? 0;
        this.map.jumpTo({ center, bearing });
        break;
      }
      case "north-up":
        this.map.jumpTo({ center, bearing: 0 });
        break;
    }
  }
}
