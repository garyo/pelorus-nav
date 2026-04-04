/**
 * Renders a projected course line from the vessel along its smoothed COG.
 * Uses shared CourseSmoothing for damped COG/SOG values.
 */

import type maplibregl from "maplibre-gl";
import type { SmoothedCourse } from "../navigation/CourseSmoothing";
import type { NavigationData } from "../navigation/NavigationData";
import {
  type CourseLineDuration,
  getSettings,
  onSettingsChange,
} from "../settings";
import { projectPoint } from "../utils/coordinates";

const SOURCE_ID = "_course-line";
const LAYER_ID = "_course-line-layer";
const VESSEL_ICON_LAYER = "_vessel-icon";

/** Minimum SOG (knots) below which the line is hidden. */
const MIN_SOG_KT = 0.1;

/** Minimum line length in meters (visible even at low speed). */
const MIN_LENGTH_M = 200;

export class CourseLine {
  private readonly map: maplibregl.Map;
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

  update(_data: NavigationData, smoothed: SmoothedCourse | null): void {
    if (!smoothed || this.duration === 0 || smoothed.sog < MIN_SOG_KT) {
      this.clearLine();
      return;
    }

    // Compute endpoint
    const durationHours = this.duration / 60;
    let distanceNM = smoothed.sog * durationHours;

    // Enforce minimum length: convert MIN_LENGTH_M to NM
    const minNM = MIN_LENGTH_M / 1852;
    if (distanceNM < minNM) {
      distanceNM = minNM;
    }

    const startLat = smoothed.lat;
    const startLon = smoothed.lon;
    const [endLon, endLat] = projectPoint(
      startLat,
      startLon,
      smoothed.cog,
      distanceNM,
    );

    this.setLine(startLon, startLat, endLon, endLat);
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
