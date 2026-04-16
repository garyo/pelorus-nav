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

/** Tick half-length in screen pixels (each side of the main line). */
const TICK_HALF_PX = 4;

/** Tick spacing in minutes, keyed by course-line duration in minutes. */
const TICK_SPACING_MIN: Record<number, number> = {
  5: 1,
  15: 5,
  30: 5,
  60: 10,
};

export class CourseLine {
  private readonly map: maplibregl.Map;
  private duration: CourseLineDuration;
  private lastData: NavigationData | null = null;
  private lastSmoothed: SmoothedCourse | null = null;

  constructor(map: maplibregl.Map) {
    this.map = map;
    this.duration = getSettings().courseLineDuration;

    onSettingsChange((s) => {
      this.duration = s.courseLineDuration;
      this.updateVisibility();
      this.redraw();
    });

    this.map.on("style.load", () => this.setup());
    if (this.map.isStyleLoaded()) {
      this.setup();
    }

    // Ticks are sized in screen pixels, so redraw on zoom/rotate/pan.
    this.map.on("move", () => this.redraw());
  }

  update(data: NavigationData, smoothed: SmoothedCourse | null): void {
    this.lastData = data;
    this.lastSmoothed = smoothed;
    this.redraw();
  }

  private redraw(): void {
    const data = this.lastData;
    const smoothed = this.lastSmoothed;
    if (
      !data ||
      !smoothed ||
      this.duration === 0 ||
      smoothed.sog < MIN_SOG_KT
    ) {
      this.clearLine();
      return;
    }

    const durationHours = this.duration / 60;
    const actualDistanceNM = smoothed.sog * durationHours;

    const minNM = MIN_LENGTH_M / 1852;
    const stretched = actualDistanceNM < minNM;
    const distanceNM = stretched ? minNM : actualDistanceNM;

    // Start from the vessel's actual position (matches the boat icon),
    // but use the smoothed COG for the projected direction.
    const startLat = data.latitude;
    const startLon = data.longitude;

    // Ticks only make sense when the line represents real time progression.
    const tickMinutes = stretched ? 0 : (TICK_SPACING_MIN[this.duration] ?? 0);
    this.setLine(startLat, startLon, smoothed.cog, distanceNM, tickMinutes);
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
    startLat: number,
    startLon: number,
    cog: number,
    distanceNM: number,
    tickMinutes: number,
  ): void {
    const source = this.map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;

    const [endLon, endLat] = projectPoint(startLat, startLon, cog, distanceNM);
    const features: GeoJSON.Feature[] = [
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
    ];

    if (tickMinutes > 0) {
      // Perpendicular unit vector in screen space (y-down), so ticks remain
      // a constant pixel length regardless of zoom/rotation.
      const startPx = this.map.project([startLon, startLat]);
      const endPx = this.map.project([endLon, endLat]);
      const dx = endPx.x - startPx.x;
      const dy = endPx.y - startPx.y;
      const lenPx = Math.hypot(dx, dy);
      if (lenPx > 0) {
        const perpX = -dy / lenPx;
        const perpY = dx / lenPx;
        const totalMin = this.duration;
        for (let t = tickMinutes; t < totalMin; t += tickMinutes) {
          const tickDist = distanceNM * (t / totalMin);
          const [cLon, cLat] = projectPoint(startLat, startLon, cog, tickDist);
          const cPx = this.map.project([cLon, cLat]);
          const lPt = this.map.unproject([
            cPx.x - perpX * TICK_HALF_PX,
            cPx.y - perpY * TICK_HALF_PX,
          ]);
          const rPt = this.map.unproject([
            cPx.x + perpX * TICK_HALF_PX,
            cPx.y + perpY * TICK_HALF_PX,
          ]);
          features.push({
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [lPt.lng, lPt.lat],
                [rPt.lng, rPt.lat],
              ],
            },
          });
        }
      }
    }

    source.setData({ type: "FeatureCollection", features });
  }

  private clearLine(): void {
    const source = this.map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;
    source.setData({ type: "FeatureCollection", features: [] });
  }
}
