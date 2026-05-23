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
const TICK_LAYER_ID = "_course-line-ticks";
const LABEL_LAYER_ID = "_course-line-labels";
const VESSEL_ICON_LAYER = "_vessel-icon";

/** Minimum SOG (knots) below which the line is hidden. */
const MIN_SOG_KT = 0.1;

/** Minimum line length in meters (visible even at low speed). */
const MIN_LENGTH_M = 200;

/** Tick half-length in screen pixels (each side of the main line). */
const TICK_HALF_PX = 6;

/** Tick spacing in minutes, keyed by course-line duration in minutes. */
const TICK_SPACING_MIN: Record<number, number> = {
  5: 1,
  15: 5,
  30: 5,
  60: 10,
};

/**
 * Auto-mode buckets — (duration, tick) pairs where `duration % tick === 0`
 * so the endpoint always lands on a tick. The fixed-mode tick lookup
 * (TICK_SPACING_MIN) draws from the same set, so a manual 15 min line
 * and an auto-picked 15 min line render identically.
 */
const AUTO_BUCKETS: { duration: number; tick: number }[] = [
  { duration: 1, tick: 0.25 }, // 1 min line, 15 s ticks (very high zoom)
  { duration: 2, tick: 0.5 }, // 2 min, 30 s
  { duration: 5, tick: 1 },
  { duration: 10, tick: 2 },
  { duration: 15, tick: 5 },
  { duration: 30, tick: 5 },
  { duration: 60, tick: 10 },
];

/**
 * Pick the auto bucket whose duration is closest to the target on a
 * log scale — feels right because [2, 5] is a bigger relative jump
 * than [10, 25].
 */
export function selectAutoBucket(targetMin: number): {
  duration: number;
  tick: number;
} {
  const t = Math.log(Math.max(targetMin, AUTO_BUCKETS[0].duration / 2));
  let best = AUTO_BUCKETS[0];
  for (const b of AUTO_BUCKETS) {
    if (
      Math.abs(Math.log(b.duration) - t) < Math.abs(Math.log(best.duration) - t)
    ) {
      best = b;
    }
  }
  return best;
}

/** Short label for a duration: "30s", "5m", "1h". */
export function formatTickLabel(min: number): string {
  if (min >= 60) return `${Math.round(min / 60)}h`;
  if (min < 1) return `${Math.round(min * 60)}s`;
  return `${min}m`;
}

export class CourseLine {
  private readonly map: maplibregl.Map;
  private duration: CourseLineDuration;
  private lastData: NavigationData | null = null;
  private lastSmoothed: SmoothedCourse | null = null;
  // Tracks whether the GeoJSON source currently holds zero features. Lets
  // redraw() short-circuit the frequent move-event path when the line is off
  // or speed is below threshold.
  private isEmpty = true;
  // Coalesces high-frequency `move` events (especially during pinch) so we
  // don't fire one full setData per gesture frame — pile-ups stall the JS
  // thread on e-ink hardware and make pinch zoom feel runaway.
  private rafPending = false;

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

    // Ticks are sized in screen pixels, so redraw on zoom/rotate/pan —
    // but coalesced via rAF.
    this.map.on("move", () => this.scheduleRedraw());
  }

  private scheduleRedraw(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.redraw();
    });
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
      if (!this.isEmpty) this.clearLine();
      return;
    }

    // Start from the vessel's actual position (matches the boat icon),
    // but use the smoothed COG for the projected direction.
    const startLat = data.latitude;
    const startLon = data.longitude;

    const { durationMin, tickMin } = this.resolveDuration(
      smoothed.sog,
      startLat,
      startLon,
    );
    const durationHours = durationMin / 60;
    const actualDistanceNM = smoothed.sog * durationHours;

    const minNM = MIN_LENGTH_M / 1852;
    const stretched = actualDistanceNM < minNM;
    const distanceNM = stretched ? minNM : actualDistanceNM;

    // Ticks only make sense when the line represents real time progression.
    const tickMinutes = stretched ? 0 : tickMin;
    this.setLine(
      startLat,
      startLon,
      smoothed.cog,
      distanceNM,
      durationMin,
      tickMinutes,
    );
  }

  /**
   * Pick the concrete duration + tick interval for this draw, either from
   * the fixed user setting or computed from sog + viewport in Auto mode.
   * In Auto mode we target a line whose midpoint lands near the canvas
   * centre (the look-ahead offset is radial so this is geometrically
   * achievable), but the duration is rounded to a bucket so the endpoint
   * label shows a clean number — readers care more about "the line ends
   * at 15 min" than about millimetre-perfect centring.
   */
  private resolveDuration(
    sog: number,
    vesselLat: number,
    vesselLon: number,
  ): { durationMin: number; tickMin: number } {
    if (this.duration === "auto") {
      // Pixels per nautical mile via the map's projection (latitude-correct).
      const c = this.map.getCenter();
      const a = this.map.project([c.lng, c.lat]);
      const b = this.map.project([c.lng, c.lat + 0.001]);
      const pxPerNM = Math.abs(b.y - a.y) / 0.001 / 60;
      // Target line length = 2 × distance(vessel → canvas-centre) in
      // screen pixels (line passes through canvas centre because the
      // look-ahead offset is radial along COG — see computeLookAheadOffsetPx).
      // Floor at half the canvas height so the line stays visible even
      // when the vessel sits at the centre (no offset applied).
      const container = this.map.getContainer();
      const vesselPx = this.map.project([vesselLon, vesselLat]);
      const dx = container.clientWidth / 2 - vesselPx.x;
      const dy = container.clientHeight / 2 - vesselPx.y;
      const distToCenterPx = Math.sqrt(dx * dx + dy * dy);
      const aheadPx = Math.max(
        2 * distToCenterPx,
        container.clientHeight * 0.5,
      );
      const targetNM = pxPerNM > 0 ? aheadPx / pxPerNM : 1;
      const targetMin = (targetNM / Math.max(sog, 0.5)) * 60;
      const bucket = selectAutoBucket(targetMin);
      return { durationMin: bucket.duration, tickMin: bucket.tick };
    }
    return {
      durationMin: this.duration,
      tickMin: TICK_SPACING_MIN[this.duration] ?? 0,
    };
  }

  private setup(): void {
    if (this.map.getSource(SOURCE_ID)) return;

    this.map.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    this.isEmpty = true;

    // Insert before vessel icon so vessel draws on top
    const beforeLayer = this.map.getLayer(VESSEL_ICON_LAYER)
      ? VESSEL_ICON_LAYER
      : undefined;

    this.map.addLayer(
      {
        id: LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        filter: ["!=", ["get", "kind"], "tick"],
        paint: {
          "line-color": "#2266dd",
          "line-width": 2,
          "line-opacity": 0.7,
        },
      },
      beforeLayer,
    );

    // Ticks need to stand out against chart clutter — darker and fully
    // opaque so they're legible over dense areas (depth labels,
    // navigation aids, etc).
    this.map.addLayer(
      {
        id: TICK_LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        filter: ["==", ["get", "kind"], "tick"],
        paint: {
          "line-color": "#164295",
          "line-width": 2,
          "line-opacity": 1,
        },
      },
      beforeLayer,
    );

    // Tick labels (first-tick interval + endpoint total).
    this.map.addLayer(
      {
        id: LABEL_LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        filter: ["==", ["get", "kind"], "label"],
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Open Sans Regular"],
          "text-size": 11,
          "text-anchor": "center",
          "text-rotation-alignment": "viewport",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#0a2056",
          "text-halo-color": "rgba(255, 255, 255, 0.9)",
          "text-halo-width": 1.5,
        },
      },
      beforeLayer,
    );

    this.updateVisibility();
  }

  private updateVisibility(): void {
    const visibility = this.duration === 0 ? "none" : "visible";
    for (const id of [LAYER_ID, TICK_LAYER_ID, LABEL_LAYER_ID]) {
      if (this.map.getLayer(id)) {
        this.map.setLayoutProperty(id, "visibility", visibility);
      }
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
    totalMin: number,
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
        properties: { kind: "main" },
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
        const labelOffsetPx = TICK_HALF_PX + 8;
        for (let t = tickMinutes; t <= totalMin; t += tickMinutes) {
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
            properties: { kind: "tick" },
            geometry: {
              type: "LineString",
              coordinates: [
                [lPt.lng, lPt.lat],
                [rPt.lng, rPt.lat],
              ],
            },
          });

          // Label the first tick (interval) and the endpoint tick (total).
          // Close-to-tolerant comparison avoids float-drift issues.
          const isFirst = Math.abs(t - tickMinutes) < 1e-6;
          const isLast = Math.abs(t - totalMin) < 1e-6;
          if (isFirst || isLast) {
            const labelPx = this.map.unproject([
              cPx.x + perpX * labelOffsetPx,
              cPx.y + perpY * labelOffsetPx,
            ]);
            features.push({
              type: "Feature",
              properties: {
                kind: "label",
                label: formatTickLabel(isLast ? totalMin : tickMinutes),
              },
              geometry: {
                type: "Point",
                coordinates: [labelPx.lng, labelPx.lat],
              },
            });
          }
        }
      }
    }

    source.setData({ type: "FeatureCollection", features });
    this.isEmpty = false;
  }

  private clearLine(): void {
    const source = this.map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;
    source.setData({ type: "FeatureCollection", features: [] });
    this.isEmpty = true;
  }
}
