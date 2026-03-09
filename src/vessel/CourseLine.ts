/**
 * Renders a projected course line from the vessel along its smoothed COG.
 * Two-stage damping: circular buffer averaging + exponential smoothing.
 */

import type maplibregl from "maplibre-gl";
import type { NavigationData } from "../navigation/NavigationData";
import {
  type CourseLineDuration,
  getSettings,
  onSettingsChange,
} from "../settings";
import { projectPoint, toRadians } from "../utils/coordinates";

const SOURCE_ID = "_course-line";
const LAYER_ID = "_course-line-layer";
const VESSEL_ICON_LAYER = "_vessel-icon";

/** Minimum SOG (knots) below which the line is hidden. */
const MIN_SOG_KT = 0.5;

/** Circular buffer window in milliseconds. */
const BUFFER_WINDOW_MS = 15_000;

/** Exponential smoothing time constant in seconds. */
const TAU_S = 3;

/** Minimum line length in meters (visible even at low speed). */
const MIN_LENGTH_M = 200;

interface Sample {
  cog: number;
  sog: number;
  timestamp: number;
}

/**
 * Compute the circular mean of angles in degrees.
 * Returns a value in [0, 360).
 */
export function circularMeanDeg(angles: number[]): number {
  let sinSum = 0;
  let cosSum = 0;
  for (const a of angles) {
    const rad = toRadians(a);
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  const meanRad = Math.atan2(sinSum, cosSum);
  return ((meanRad * 180) / Math.PI + 360) % 360;
}

/**
 * Interpolate between two angles (degrees) along the shorter arc.
 * `t` is the interpolation factor (0 = from, 1 = to).
 */
export function circularInterpolate(
  from: number,
  to: number,
  t: number,
): number {
  let diff = to - from;
  // Normalize to [-180, 180]
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return (((from + diff * t) % 360) + 360) % 360;
}

export class CourseLine {
  private readonly map: maplibregl.Map;
  private buffer: Sample[] = [];
  private displayedCog = 0;
  private displayedSog = 0;
  private lastUpdateTime = 0;
  private initialized = false;
  private duration: CourseLineDuration;

  constructor(map: maplibregl.Map) {
    this.map = map;
    this.duration = getSettings().courseLineDuration;

    onSettingsChange((s) => {
      this.duration = s.courseLineDuration;
      this.updateVisibility();
    });

    this.map.on("style.load", () => this.setup());
    if (this.map.isStyleLoaded()) {
      this.setup();
    }
  }

  update(data: NavigationData): void {
    const now = data.timestamp;

    // Add sample to buffer if COG/SOG are available
    if (data.cog !== null && data.sog !== null) {
      this.buffer.push({ cog: data.cog, sog: data.sog, timestamp: now });
    }

    // Prune old samples
    const cutoff = now - BUFFER_WINDOW_MS;
    while (this.buffer.length > 0 && this.buffer[0].timestamp < cutoff) {
      this.buffer.shift();
    }

    // Need samples and a valid duration to render
    if (this.buffer.length === 0 || this.duration === 0) {
      this.clearLine();
      return;
    }

    // Stage 1: circular buffer averages
    const avgCog = circularMeanDeg(this.buffer.map((s) => s.cog));
    let avgSog = 0;
    for (const s of this.buffer) avgSog += s.sog;
    avgSog /= this.buffer.length;

    // Stage 2: exponential smoothing
    if (!this.initialized) {
      this.displayedCog = avgCog;
      this.displayedSog = avgSog;
      this.lastUpdateTime = now;
      this.initialized = true;
    } else {
      const dt = (now - this.lastUpdateTime) / 1000; // seconds
      this.lastUpdateTime = now;
      const alpha = 1 - Math.exp(-dt / TAU_S);
      this.displayedCog = circularInterpolate(this.displayedCog, avgCog, alpha);
      this.displayedSog += alpha * (avgSog - this.displayedSog);
    }

    // Hide line below minimum SOG
    if (this.displayedSog < MIN_SOG_KT) {
      this.clearLine();
      return;
    }

    // Compute endpoint
    const durationHours = this.duration / 60;
    let distanceNM = this.displayedSog * durationHours;

    // Enforce minimum length: convert MIN_LENGTH_M to NM
    const minNM = MIN_LENGTH_M / 1852;
    if (distanceNM < minNM) {
      distanceNM = minNM;
    }

    const [endLon, endLat] = projectPoint(
      data.latitude,
      data.longitude,
      this.displayedCog,
      distanceNM,
    );

    this.setLine(data.longitude, data.latitude, endLon, endLat);
  }

  private setup(): void {
    if (this.map.getSource(SOURCE_ID)) return;

    this.map.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    // Insert before vessel icon so vessel draws on top
    const beforeLayer = this.map.getLayer(VESSEL_ICON_LAYER)
      ? VESSEL_ICON_LAYER
      : undefined;

    this.map.addLayer(
      {
        id: LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": "#2266dd",
          "line-width": 2,
          "line-opacity": 0.7,
        },
      },
      beforeLayer,
    );

    this.updateVisibility();
  }

  private updateVisibility(): void {
    if (this.map.getLayer(LAYER_ID)) {
      this.map.setLayoutProperty(
        LAYER_ID,
        "visibility",
        this.duration === 0 ? "none" : "visible",
      );
    }
    if (this.duration === 0) {
      this.clearLine();
    }
  }

  private setLine(
    startLon: number,
    startLat: number,
    endLon: number,
    endLat: number,
  ): void {
    const source = this.map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;

    source.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [startLon, startLat],
              [endLon, endLat],
            ],
          },
        },
      ],
    });
  }

  private clearLine(): void {
    const source = this.map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;
    source.setData({ type: "FeatureCollection", features: [] });
  }
}
