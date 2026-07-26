/**
 * Map visuals for track-view mode: the viewed track drawn as a gradient
 * line (colored by speed, course, or time) with a casing for contrast,
 * maneuver markers, and a vessel-shaped cursor that scrubs along it.
 *
 * On the e-ink theme the gradient is replaced by a plain high-contrast
 * line — a color ramp carries no information in grayscale.
 */

import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";
import type * as maplibregl from "maplibre-gl";
import {
  type Maneuver,
  type TrackAnalysis,
  type TrackColorMode,
  type TrackCursor,
  trackGradientStops,
} from "../data/track-analysis";
import { getSettings } from "../settings";
import { bboxOfCoords } from "../utils/coordinates";
import { fitMapToBounds } from "./fit-bounds";

const SRC_LINE = "_track-viewer-line-src";
const LYR_CASING = "_track-viewer-casing";
const LYR_LINE = "_track-viewer-line";
const SRC_MANEUVERS = "_track-viewer-maneuvers-src";
const LYR_MANEUVERS = "_track-viewer-maneuvers";
const SRC_RANGE = "_track-viewer-range-src";
const LYR_RANGE = "_track-viewer-range";
const SRC_CURSOR = "_track-viewer-cursor-src";
const LYR_CURSOR = "_track-viewer-cursor";
const IMG_CURSOR = "_track-viewer-cursor-img";

const LINE_WIDTH = 4;

export class TrackViewerLayer {
  private readonly map: maplibregl.Map;
  private analysis: TrackAnalysis | null = null;
  private maneuvers: Maneuver[] = [];
  private cursor: TrackCursor | null = null;
  private colorMode: TrackColorMode = "speed";
  private bottomPadPx = 220;
  /** Coordinates of the selected range, kept across style rebuilds. */
  private rangeCoords: [number, number][] = [];
  private maneuverClickCb?: (timestamp: number) => void;

  constructor(map: maplibregl.Map) {
    this.map = map;
    // Re-add after theme/settings style rebuilds while the viewer is open
    map.on("style.load", () => {
      if (this.analysis) this.setup();
    });
    // Tap a maneuver marker to jump the scrub cursor there
    map.on("click", LYR_MANEUVERS, (e) => {
      const ts = e.features?.[0]?.properties?.timestamp;
      if (typeof ts === "number") this.maneuverClickCb?.(ts);
    });
  }

  /** Register a handler for taps on maneuver markers. */
  onManeuverClick(cb: (timestamp: number) => void): void {
    this.maneuverClickCb = cb;
  }

  /** Show or hide the maneuver markers (viewer toolbar toggle). */
  setManeuversVisible(show: boolean): void {
    if (this.map.getLayer(LYR_MANEUVERS)) {
      this.map.setLayoutProperty(
        LYR_MANEUVERS,
        "visibility",
        show ? "visible" : "none",
      );
    }
  }

  /**
   * Show the given track and fit the viewport to it. `bottomPadPx` is the
   * viewer panel's height, so the fit keeps the track clear of it.
   */
  show(
    analysis: TrackAnalysis,
    maneuvers: Maneuver[],
    bottomPadPx?: number,
  ): void {
    this.analysis = analysis;
    this.maneuvers = maneuvers;
    if (bottomPadPx !== undefined) this.bottomPadPx = bottomPadPx;
    this.setup();
    this.fitBounds();
  }

  /** Switch what drives the gradient color. */
  setColorMode(mode: TrackColorMode): void {
    if (mode === this.colorMode) return;
    this.colorMode = mode;
    if (this.analysis) this.setup();
  }

  /** Center the map on the cursor (follow-cursor playback). */
  centerOn(cursor: TrackCursor): void {
    this.map.jumpTo({ center: [cursor.lon, cursor.lat] });
  }

  /**
   * Highlight the track span between two cursors (range-select stats),
   * or clear it with null. Endpoints are interpolated positions.
   */
  setRangeHighlight(start: TrackCursor | null, end?: TrackCursor): void {
    const a = this.analysis;
    if (!a || !start || !end) {
      this.rangeCoords = [];
    } else {
      const coords: [number, number][] = [[start.lon, start.lat]];
      for (let i = start.index + 1; i <= end.index; i++) {
        coords.push([a.points[i].lon, a.points[i].lat]);
      }
      coords.push([end.lon, end.lat]);
      this.rangeCoords = coords;
    }
    const src = this.map.getSource(SRC_RANGE) as
      | maplibregl.GeoJSONSource
      | undefined;
    src?.setData(this.rangeGeoJSON());
  }

  /** Move the scrub cursor. */
  setCursor(cursor: TrackCursor): void {
    this.cursor = cursor;
    const src = this.map.getSource(SRC_CURSOR) as
      | maplibregl.GeoJSONSource
      | undefined;
    src?.setData(this.cursorGeoJSON());
  }

  hide(): void {
    this.analysis = null;
    this.maneuvers = [];
    this.cursor = null;
    this.rangeCoords = [];
    for (const lyr of [
      LYR_CURSOR,
      LYR_MANEUVERS,
      LYR_LINE,
      LYR_CASING,
      LYR_RANGE,
    ]) {
      if (this.map.getLayer(lyr)) this.map.removeLayer(lyr);
    }
    for (const src of [SRC_CURSOR, SRC_MANEUVERS, SRC_RANGE, SRC_LINE]) {
      if (this.map.getSource(src)) this.map.removeSource(src);
    }
  }

  private setup(): void {
    const a = this.analysis;
    if (!a) return;
    const eink = getSettings().displayTheme === "eink";

    // Tear down any stale layers (e.g. theme switch or color-mode re-entry)
    for (const lyr of [
      LYR_CURSOR,
      LYR_MANEUVERS,
      LYR_LINE,
      LYR_CASING,
      LYR_RANGE,
    ]) {
      if (this.map.getLayer(lyr)) this.map.removeLayer(lyr);
    }

    const line: GeoJSON.Feature = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: a.points.map((p) => [p.lon, p.lat]),
      },
    };
    const lineSrc = this.map.getSource(SRC_LINE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (lineSrc) {
      lineSrc.setData(line);
    } else {
      // lineMetrics is required for line-gradient / line-progress.
      // tolerance:0 disables MapLibre's default tile-space simplification,
      // which would otherwise decimate a track confined to a small area.
      this.map.addSource(SRC_LINE, {
        type: "geojson",
        data: line,
        lineMetrics: true,
        tolerance: 0,
      });
    }

    // Range-select highlight — a wide marker-pen band under the track.
    // Yellow on day/dusk; red-tinted on night to spare night vision.
    const theme = getSettings().displayTheme;
    const rangeStyle = eink
      ? { color: "#000000", opacity: 0.35 }
      : theme === "night"
        ? { color: "#ff5533", opacity: 0.55 }
        : { color: "#ffd200", opacity: 0.8 };
    const rangeSrc = this.map.getSource(SRC_RANGE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (rangeSrc) {
      rangeSrc.setData(this.rangeGeoJSON());
    } else {
      this.map.addSource(SRC_RANGE, {
        type: "geojson",
        data: this.rangeGeoJSON(),
      });
    }
    this.map.addLayer({
      id: LYR_RANGE,
      type: "line",
      source: SRC_RANGE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": rangeStyle.color,
        "line-width": LINE_WIDTH + 14,
        "line-blur": 2,
        "line-opacity": rangeStyle.opacity,
      },
    });

    if (!eink) {
      this.map.addLayer({
        id: LYR_CASING,
        type: "line",
        source: SRC_LINE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-width": LINE_WIDTH + 3,
          "line-opacity": 0.55,
        },
      });
    }

    const stops = trackGradientStops(a, this.colorMode);
    this.map.addLayer({
      id: LYR_LINE,
      type: "line",
      source: SRC_LINE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: eink
        ? { "line-color": "#000000", "line-width": LINE_WIDTH - 1 }
        : stops.length > 1
          ? {
              "line-width": LINE_WIDTH,
              "line-gradient": [
                "interpolate",
                ["linear"],
                ["line-progress"],
                ...stops.flat(),
              ] as ExpressionSpecification,
            }
          : { "line-color": stops[0][1], "line-width": LINE_WIDTH },
    });

    // Maneuver markers — tap to jump the cursor there
    const maneuverData: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: this.maneuvers.map((m) => ({
        type: "Feature",
        properties: { timestamp: m.timestamp },
        geometry: { type: "Point", coordinates: [m.lon, m.lat] },
      })),
    };
    const manSrc = this.map.getSource(SRC_MANEUVERS) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (manSrc) {
      manSrc.setData(maneuverData);
    } else {
      this.map.addSource(SRC_MANEUVERS, {
        type: "geojson",
        data: maneuverData,
      });
    }
    // Small beads on the line when zoomed out, tappable dots when zoomed
    // in. Dark on the colored gradient; inverted on e-ink's black line.
    this.map.addLayer({
      id: LYR_MANEUVERS,
      type: "circle",
      source: SRC_MANEUVERS,
      layout: {
        visibility: getSettings().trackShowManeuvers ? "visible" : "none",
      },
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8,
          1.5,
          13,
          2.5,
          16,
          5,
        ] as ExpressionSpecification,
        "circle-color": eink ? "#ffffff" : "#1a3a8c",
        "circle-opacity": 0.9,
        "circle-stroke-width": 1,
        "circle-stroke-color": eink ? "#000000" : "#ffffff",
      },
    });

    this.addCursorImage(eink);
    if (!this.map.getSource(SRC_CURSOR)) {
      this.map.addSource(SRC_CURSOR, {
        type: "geojson",
        data: this.cursorGeoJSON(),
      });
    }
    this.map.addLayer({
      id: LYR_CURSOR,
      type: "symbol",
      source: SRC_CURSOR,
      layout: {
        "icon-image": IMG_CURSOR,
        "icon-size": 1,
        "icon-rotate": ["get", "cog"],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
  }

  /** Draw the vessel-shaped scrub cursor (canvas → map image, theme-aware). */
  private addCursorImage(eink: boolean): void {
    if (this.map.hasImage(IMG_CURSOR)) this.map.removeImage(IMG_CURSOR);
    const size = 56; // drawn at 2x for retina, renders 28 CSS px
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Boat-ish pointer: rounded stern, pointed bow (up = COG 0°)
    const cx = size / 2;
    ctx.beginPath();
    ctx.moveTo(cx, 6); // bow
    ctx.quadraticCurveTo(cx + 13, size * 0.55, cx + 10, size - 10);
    ctx.quadraticCurveTo(cx, size - 16, cx - 10, size - 10);
    ctx.quadraticCurveTo(cx - 13, size * 0.55, cx, 6);
    ctx.closePath();
    ctx.fillStyle = eink ? "#000000" : "#1a3a8c";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.fill();
    ctx.stroke();

    this.map.addImage(IMG_CURSOR, ctx.getImageData(0, 0, size, size), {
      pixelRatio: 2,
    });
  }

  private rangeGeoJSON(): GeoJSON.FeatureCollection {
    if (this.rangeCoords.length < 2) {
      return { type: "FeatureCollection", features: [] };
    }
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: this.rangeCoords },
        },
      ],
    };
  }

  private cursorGeoJSON(): GeoJSON.FeatureCollection {
    if (!this.cursor) return { type: "FeatureCollection", features: [] };
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { cog: this.cursor.cogDeg },
          geometry: {
            type: "Point",
            coordinates: [this.cursor.lon, this.cursor.lat],
          },
        },
      ],
    };
  }

  private fitBounds(): void {
    const a = this.analysis;
    if (!a) return;
    const bbox = bboxOfCoords(a.points.map((p) => [p.lon, p.lat]));
    if (!bbox) return;
    const [minLon, minLat, maxLon, maxLat] = bbox;
    // Pad for the viewer panel, clamped to canvas fractions so the fit
    // still has room to work with on a landscape phone.
    const canvas = this.map.getCanvas();
    const h = canvas.clientHeight;
    const w = canvas.clientWidth;
    const padding = {
      top: Math.min(90, Math.round(h * 0.12)),
      bottom: Math.min(this.bottomPadPx + 16, Math.round(h * 0.55)),
      left: Math.min(60, Math.round(w * 0.08)),
      right: Math.min(60, Math.round(w * 0.08)),
    };
    fitMapToBounds(
      this.map,
      [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      { padding, duration: 500 },
    );
  }
}
