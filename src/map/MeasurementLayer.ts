/**
 * Measurement tool: distance and bearing between two points on the map.
 * Points are draggable; info panel shows distance (NM), bearing, and reverse bearing.
 */

import type maplibregl from "maplibre-gl";
import { haversineDistanceNM, initialBearingDeg } from "../utils/coordinates";
import { DraggablePoints } from "./DraggablePoints";
import { getMode, setMode } from "./InteractionMode";
import { ensurePointIcons, ROLE_ICON_EXPR } from "./point-icons";

const SOURCE_POINTS = "_measure-points";
const SOURCE_LINE = "_measure-line";
const LAYER_POINTS = "_measure-points";
const LAYER_LINE = "_measure-line";

interface MeasurePoint {
  lng: number;
  lat: number;
}

export class MeasurementLayer {
  private readonly map: maplibregl.Map;
  private pointA: MeasurePoint | null = null;
  private pointB: MeasurePoint | null = null;
  private draggable: DraggablePoints | null = null;
  private panel: HTMLDivElement;
  private clickHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;

  constructor(map: maplibregl.Map) {
    this.map = map;

    this.panel = document.createElement("div");
    this.panel.className = "measure-panel";
    this.panel.style.display = "none";
    document.body.appendChild(this.panel);

    map.on("style.load", () => this.setupLayers());
    if (map.isStyleLoaded()) this.setupLayers();
  }

  /** Start measurement from a given point (called from context menu). */
  startFrom(lng: number, lat: number): void {
    this.clear();
    setMode("measure");
    this.pointA = { lng, lat };
    this.pointB = null;
    this.updateSources();
    this.showPanel();

    this.clickHandler = (e: maplibregl.MapMouseEvent) => {
      if (getMode() !== "measure") return;
      if (!this.pointA || this.pointB) return;
      this.pointB = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      this.updateSources();
      this.showPanel();
      this.setupDrag();
      // Remove click handler after second point placed
      if (this.clickHandler) {
        this.map.off("click", this.clickHandler);
        this.clickHandler = null;
      }
    };
    this.map.on("click", this.clickHandler);
  }

  /** Clear measurement and return to query mode. */
  clear(): void {
    this.pointA = null;
    this.pointB = null;
    if (this.clickHandler) {
      this.map.off("click", this.clickHandler);
      this.clickHandler = null;
    }
    if (this.draggable) {
      this.draggable.destroy();
      this.draggable = null;
    }
    this.updateSources();
    this.panel.style.display = "none";
    if (getMode() === "measure") {
      setMode("query");
    }
  }

  private setupLayers(): void {
    if (this.map.getSource(SOURCE_LINE)) return;

    this.map.addSource(SOURCE_LINE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    this.map.addSource(SOURCE_POINTS, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    this.map.addLayer({
      id: LAYER_LINE,
      type: "line",
      source: SOURCE_LINE,
      paint: {
        "line-color": "#ff8800",
        "line-width": 2,
        "line-dasharray": [4, 3],
      },
    });

    ensurePointIcons(this.map);
    this.map.addLayer({
      id: LAYER_POINTS,
      type: "symbol",
      source: SOURCE_POINTS,
      layout: {
        "icon-image": ROLE_ICON_EXPR,
        "icon-size": 1,
        "icon-allow-overlap": true,
      },
    });
  }

  private setupDrag(): void {
    if (this.draggable) this.draggable.destroy();
    this.draggable = new DraggablePoints(
      this.map,
      LAYER_POINTS,
      (index, lngLat) => {
        const pt = { lng: lngLat.lng, lat: lngLat.lat };
        if (index === 0) this.pointA = pt;
        else this.pointB = pt;
        this.updateSources();
        this.showPanel();
      },
    );
  }

  private updateSources(): void {
    const lineSrc = this.map.getSource(SOURCE_LINE) as
      | maplibregl.GeoJSONSource
      | undefined;
    const ptSrc = this.map.getSource(SOURCE_POINTS) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!lineSrc || !ptSrc) return;

    const points: GeoJSON.Feature[] = [];
    if (this.pointA) {
      points.push({
        type: "Feature",
        properties: { index: 0, role: "start" },
        geometry: {
          type: "Point",
          coordinates: [this.pointA.lng, this.pointA.lat],
        },
      });
    }
    if (this.pointB) {
      points.push({
        type: "Feature",
        properties: { index: 1, role: "finish" },
        geometry: {
          type: "Point",
          coordinates: [this.pointB.lng, this.pointB.lat],
        },
      });
    }
    ptSrc.setData({ type: "FeatureCollection", features: points });

    if (this.pointA && this.pointB) {
      lineSrc.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [this.pointA.lng, this.pointA.lat],
                [this.pointB.lng, this.pointB.lat],
              ],
            },
          },
        ],
      });
    } else {
      lineSrc.setData({ type: "FeatureCollection", features: [] });
    }
  }

  private showPanel(): void {
    if (!this.pointA) {
      this.panel.style.display = "none";
      return;
    }

    this.panel.style.display = "block";

    if (!this.pointB) {
      this.panel.innerHTML =
        '<div class="measure-panel-text">Click to place second point</div>' +
        '<button class="measure-panel-close">&times;</button>';
      this.panel
        .querySelector(".measure-panel-close")
        ?.addEventListener("click", () => this.clear());
      return;
    }

    const dist = haversineDistanceNM(
      this.pointA.lat,
      this.pointA.lng,
      this.pointB.lat,
      this.pointB.lng,
    );
    const bearing = initialBearingDeg(
      this.pointA.lat,
      this.pointA.lng,
      this.pointB.lat,
      this.pointB.lng,
    );
    const reverseBearing = initialBearingDeg(
      this.pointB.lat,
      this.pointB.lng,
      this.pointA.lat,
      this.pointA.lng,
    );

    this.panel.innerHTML =
      '<div class="measure-panel-text">' +
      `<strong>${dist.toFixed(2)} NM</strong> &nbsp; ` +
      `${bearing.toFixed(1)}&deg;T &nbsp; ` +
      `(rev ${reverseBearing.toFixed(1)}&deg;T)` +
      "</div>" +
      '<button class="measure-panel-close">&times;</button>';
    this.panel
      .querySelector(".measure-panel-close")
      ?.addEventListener("click", () => this.clear());
  }
}
