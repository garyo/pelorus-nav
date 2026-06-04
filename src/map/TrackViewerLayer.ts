/**
 * Map visuals for track-view mode: the viewed track drawn as a
 * speed-colored gradient line with a casing for contrast, plus a
 * vessel-shaped cursor that scrubs along it.
 *
 * On the e-ink theme the gradient is replaced by a plain high-contrast
 * line — a color ramp carries no information in grayscale.
 */

import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";
import type maplibregl from "maplibre-gl";
import {
  speedGradientStops,
  type TrackAnalysis,
  type TrackCursor,
} from "../data/track-analysis";
import { getSettings } from "../settings";
import { fitMapToBounds } from "./fit-bounds";

const SRC_LINE = "_track-viewer-line-src";
const LYR_CASING = "_track-viewer-casing";
const LYR_LINE = "_track-viewer-line";
const SRC_CURSOR = "_track-viewer-cursor-src";
const LYR_CURSOR = "_track-viewer-cursor";
const IMG_CURSOR = "_track-viewer-cursor-img";

const LINE_WIDTH = 4;

export class TrackViewerLayer {
  private readonly map: maplibregl.Map;
  private analysis: TrackAnalysis | null = null;
  private cursor: TrackCursor | null = null;

  constructor(map: maplibregl.Map) {
    this.map = map;
    // Re-add after theme/settings style rebuilds while the viewer is open
    map.on("style.load", () => {
      if (this.analysis) this.setup();
    });
  }

  /** Show the given track and fit the viewport to it. */
  show(analysis: TrackAnalysis): void {
    this.analysis = analysis;
    this.setup();
    this.fitBounds();
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
    this.cursor = null;
    for (const lyr of [LYR_CURSOR, LYR_LINE, LYR_CASING]) {
      if (this.map.getLayer(lyr)) this.map.removeLayer(lyr);
    }
    for (const src of [SRC_CURSOR, SRC_LINE]) {
      if (this.map.getSource(src)) this.map.removeSource(src);
    }
  }

  private setup(): void {
    const a = this.analysis;
    if (!a) return;
    const eink = getSettings().displayTheme === "eink";

    // Tear down any stale layers (e.g. theme switch re-entry)
    for (const lyr of [LYR_CURSOR, LYR_LINE, LYR_CASING]) {
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
      // lineMetrics is required for line-gradient / line-progress
      this.map.addSource(SRC_LINE, {
        type: "geojson",
        data: line,
        lineMetrics: true,
      });
    }

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

    const stops = speedGradientStops(a);
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
    let minLon = a.points[0].lon;
    let minLat = a.points[0].lat;
    let maxLon = minLon;
    let maxLat = minLat;
    for (const p of a.points) {
      if (p.lon < minLon) minLon = p.lon;
      else if (p.lon > maxLon) maxLon = p.lon;
      if (p.lat < minLat) minLat = p.lat;
      else if (p.lat > maxLat) maxLat = p.lat;
    }
    fitMapToBounds(
      this.map,
      [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      // Extra bottom padding keeps the track clear of the viewer panel
      { padding: { top: 90, left: 60, right: 60, bottom: 220 }, duration: 500 },
    );
  }
}
