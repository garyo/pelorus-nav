/**
 * Renders the vessel position on the map using GeoJSON source + layers.
 * Canvas-drawn boat icon, rotated by heading/COG, with optional accuracy circle.
 */

import type maplibregl from "maplibre-gl";
import type { NavigationData } from "../navigation/NavigationData";
import { getSettings, onSettingsChange } from "../settings";
import { accuracyCircleGeoJSON } from "./accuracy-circle";

const VESSEL_SOURCE = "_vessel-position";
const ACCURACY_SOURCE = "_vessel-accuracy";
const VESSEL_ICON = "_vessel-icon";
const ICON_SIZE = 32;
const SHADOW_PAD = 8; // extra canvas space for drop shadow
const CANVAS_SIZE = ICON_SIZE + SHADOW_PAD * 2;

export class VesselLayer {
  private readonly map: maplibregl.Map;
  private lastData: NavigationData | null = null;
  private showAccuracy: boolean;

  constructor(map: maplibregl.Map) {
    this.map = map;
    this.showAccuracy = getSettings().showAccuracyCircle ?? true;

    onSettingsChange((s) => {
      this.showAccuracy = s.showAccuracyCircle ?? true;
      this.updateAccuracyVisibility();
    });

    this.map.on("style.load", () => this.setup());
    if (this.map.isStyleLoaded()) {
      this.setup();
    }
  }

  update(data: NavigationData): void {
    this.lastData = data;
    this.updatePosition();
  }

  private setup(): void {
    this.createVesselIcon();
    this.addSources();
    this.addLayers();
    if (this.lastData) {
      this.updatePosition();
    }
  }

  private createVesselIcon(): void {
    const canvas = document.createElement("canvas");
    const ratio = window.devicePixelRatio || 1;
    canvas.width = CANVAS_SIZE * ratio;
    canvas.height = CANVAS_SIZE * ratio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(ratio, ratio);
    // Offset drawing so the icon is centered with padding for shadow
    ctx.translate(SHADOW_PAD, SHADOW_PAD);
    const cx = ICON_SIZE / 2;

    // Drop shadow for contrast against busy charts (DEBUG: exaggerated)
    ctx.shadowColor = "rgba(0, 0, 0, 1)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Draw a vessel triangle pointing up (north)
    ctx.beginPath();
    ctx.moveTo(cx, 4); // bow
    ctx.lineTo(cx + 10, ICON_SIZE - 6); // starboard stern
    ctx.lineTo(cx, ICON_SIZE - 10); // center stern notch
    ctx.lineTo(cx - 10, ICON_SIZE - 6); // port stern
    ctx.closePath();

    ctx.fillStyle = "#2266dd";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (this.map.hasImage(VESSEL_ICON)) {
      this.map.removeImage(VESSEL_ICON);
    }
    this.map.addImage(
      VESSEL_ICON,
      {
        width: CANVAS_SIZE * ratio,
        height: CANVAS_SIZE * ratio,
        data: ctx.getImageData(0, 0, CANVAS_SIZE * ratio, CANVAS_SIZE * ratio)
          .data,
      },
      { pixelRatio: ratio },
    );
  }

  private addSources(): void {
    if (this.map.getSource(VESSEL_SOURCE)) return;

    this.map.addSource(VESSEL_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    this.map.addSource(ACCURACY_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }

  private addLayers(): void {
    if (this.map.getLayer("_vessel-accuracy-fill")) return;

    this.map.addLayer({
      id: "_vessel-accuracy-fill",
      type: "fill",
      source: ACCURACY_SOURCE,
      paint: {
        "fill-color": "#2266dd",
        "fill-opacity": 0.1,
      },
    });

    this.map.addLayer({
      id: "_vessel-accuracy-outline",
      type: "line",
      source: ACCURACY_SOURCE,
      paint: {
        "line-color": "#2266dd",
        "line-width": 1,
        "line-opacity": 0.4,
      },
    });

    this.map.addLayer({
      id: "_vessel-icon",
      type: "symbol",
      source: VESSEL_SOURCE,
      layout: {
        "icon-image": VESSEL_ICON,
        "icon-size": 1,
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-rotate": ["get", "heading"],
      },
    });

    this.updateAccuracyVisibility();
  }

  /** Move vessel layers to the top so nothing draws over the boat. */
  private ensureOnTop(): void {
    const layers = this.map.getStyle()?.layers;
    if (!layers?.length) return;
    const topId = layers[layers.length - 1].id;
    // Already on top — skip to avoid unnecessary symbol re-placement
    if (topId === "_vessel-icon") return;
    if (this.map.getLayer("_vessel-accuracy-fill")) {
      this.map.moveLayer("_vessel-accuracy-fill");
    }
    if (this.map.getLayer("_vessel-accuracy-outline")) {
      this.map.moveLayer("_vessel-accuracy-outline");
    }
    if (this.map.getLayer("_vessel-icon")) {
      this.map.moveLayer("_vessel-icon");
    }
  }

  private updatePosition(): void {
    const data = this.lastData;
    if (!data) return;

    this.ensureOnTop();

    const vesselSource = this.map.getSource(VESSEL_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (vesselSource) {
      const rotation = data.heading ?? data.cog ?? 0;
      vesselSource.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { heading: rotation },
            geometry: {
              type: "Point",
              coordinates: [data.longitude, data.latitude],
            },
          },
        ],
      });
    }

    const accuracySource = this.map.getSource(ACCURACY_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (accuracySource && data.accuracy && data.accuracy > 0) {
      accuracySource.setData({
        type: "FeatureCollection",
        features: [
          accuracyCircleGeoJSON(data.latitude, data.longitude, data.accuracy),
        ],
      });
    }
  }

  private updateAccuracyVisibility(): void {
    const vis = this.showAccuracy ? "visible" : "none";
    if (this.map.getLayer("_vessel-accuracy-fill")) {
      this.map.setLayoutProperty("_vessel-accuracy-fill", "visibility", vis);
    }
    if (this.map.getLayer("_vessel-accuracy-outline")) {
      this.map.setLayoutProperty("_vessel-accuracy-outline", "visibility", vis);
    }
  }
}
