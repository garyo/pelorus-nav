/**
 * Renders a dashed bearing line from the vessel to the active navigation target.
 * Follows the CourseLine pattern: GeoJSON source + line layer.
 */

import type maplibregl from "maplibre-gl";
import type {
  ActiveNavigationInfo,
  ActiveNavigationManager,
  ActiveNavigationState,
} from "../navigation/ActiveNavigation";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";

const SOURCE_ID = "_bearing-line";
const LINE_LAYER = "_bearing-line-layer";
const TARGET_LAYER = "_bearing-line-target";
export class BearingLine {
  private readonly map: maplibregl.Map;
  private readonly activeNav: ActiveNavigationManager;
  private readonly navManager: NavigationDataManager;

  constructor(
    map: maplibregl.Map,
    activeNav: ActiveNavigationManager,
    navManager: NavigationDataManager,
  ) {
    this.map = map;
    this.activeNav = activeNav;
    this.navManager = navManager;

    this.activeNav.subscribe(this.onNavUpdate);
    map.on("style.load", () => this.setup());
    if (map.isStyleLoaded()) this.setup();
  }

  private readonly onNavUpdate = (
    info: ActiveNavigationInfo | null,
    _state: ActiveNavigationState,
  ): void => {
    if (!info) {
      this.clear();
      return;
    }

    const vessel = this.navManager.getLastData();
    if (!vessel) {
      this.clear();
      return;
    }

    this.setLine(
      vessel.longitude,
      vessel.latitude,
      info.targetLon,
      info.targetLat,
    );
  };

  private setup(): void {
    if (this.map.getSource(SOURCE_ID)) return;

    this.map.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    // Append on top — VesselLayer.ensureOnTop() keeps the boat above us
    this.map.addLayer({
      id: LINE_LAYER,
      type: "line",
      source: SOURCE_ID,
      filter: ["==", "$type", "LineString"],
      paint: {
        "line-color": "#ffdd00",
        "line-width": 2.5,
        "line-opacity": 0.8,
        "line-dasharray": [4, 3],
      },
    });

    this.map.addLayer({
      id: TARGET_LAYER,
      type: "circle",
      source: SOURCE_ID,
      filter: ["==", "$type", "Point"],
      paint: {
        "circle-radius": 8,
        "circle-color": "transparent",
        "circle-stroke-color": "#ffdd00",
        "circle-stroke-width": 2.5,
      },
    });
  }

  private setLine(
    startLon: number,
    startLat: number,
    endLon: number,
    endLat: number,
  ): void {
    // Keep bearing line above routes/waypoints (vessel ensures it stays above us)
    if (this.map.getLayer(LINE_LAYER)) this.map.moveLayer(LINE_LAYER);
    if (this.map.getLayer(TARGET_LAYER)) this.map.moveLayer(TARGET_LAYER);

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
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Point",
            coordinates: [endLon, endLat],
          },
        },
      ],
    });
  }

  private clear(): void {
    const source = this.map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;
    source.setData({ type: "FeatureCollection", features: [] });
  }
}
