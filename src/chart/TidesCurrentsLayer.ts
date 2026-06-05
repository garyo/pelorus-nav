/**
 * Tides & currents overlay — fully offline.
 *
 * Draws tide-station icons (with height + rising/falling label) and
 * current arrows (rotated to set, scaled by drift) from the bundled NOAA
 * station data, computing harmonic predictions client-side. Clicking a
 * station shows upcoming events (high/low, max flood/slack/max ebb) in a
 * FeatureInfoPanel.
 */

import type { Feature, FeatureCollection } from "geojson";
import type maplibregl from "maplibre-gl";
import { getMode } from "../map/InteractionMode";
import {
  formatDepth,
  getSettings,
  onSettingsChange,
  type SymbologyScheme,
} from "../settings";
import {
  type CurrentStation,
  isCurrentRef,
  isTideRef,
  loadTidesIndex,
  stationsInBounds,
  type TideStation,
  type TidesIndex,
} from "../tides/bundle";
import { currentState } from "../tides/currents";
import {
  formatCurrentEvent,
  formatEventTime,
  formatSpeed,
  formatTideEvent,
  formatTideHeight,
} from "../tides/format";
import { tideNow, tideState } from "../tides/predictor";
import { FeatureInfoPanel } from "./FeatureInfoPanel";
import type { FeatureInfo } from "./feature-info";
import { s52Colour } from "./s52-colours";

const SOURCE_ID = "_tides-currents";
const LAYER_TIDE = "_tide-stations";
const LAYER_CURRENT = "_current-arrows";
const LAYER_SLACK = "_current-slack";

const MIN_ZOOM = 9;
/** Cap on stations rendered at once; harmonic stations win when over. */
const MAX_STATIONS = 400;

/** Now-state refresh cadence; e-ink refreshes less often to avoid repaints. */
const REFRESH_MS = 5 * 60 * 1000;
const REFRESH_EINK_MS = 15 * 60 * 1000;

/** Hours of upcoming events to list in the station popup. */
const POPUP_WINDOW_HRS = 26;

/**
 * Sprite names per symbology scheme (must exist in the active sheet).
 * `tideGauge` and `arrow` are fill-state series indexed by the feature's
 * `_fill` bucket (0–4 = 0–100% of the station's cycle range/max).
 */
interface SpriteSet {
  /** Neutral waves icon for subordinate tide stations (no height curve). */
  tideNeutral: string;
  tideGauge: string[];
  arrow: string[];
}

const NAUTICAL_SPRITES: SpriteSet = {
  tideNeutral: "ecdis-tide-station",
  tideGauge: [0, 1, 2, 3, 4].map((i) => `ecdis-tide-gauge-${i}`),
  arrow: [0, 1, 2, 3, 4].map((i) => `ecdis-current-arrow-${i}`),
};

const SPRITES: Record<SymbologyScheme, SpriteSet> = {
  "pelorus-standard": NAUTICAL_SPRITES,
  "simplified-minimal": NAUTICAL_SPRITES,
  "iho-s52": {
    tideNeutral: "PELTID01",
    tideGauge: [0, 1, 2, 3, 4].map((i) => `PELTIDG${i}`),
    arrow: [1, 2, 3, 4, 5].map((i) => `PELCUR0${i}`),
  },
};

/** Build an icon-image expression mapping the `_fill` bucket to a sprite. */
function fillIconExpr(series: string[], fallback: string): unknown {
  const expr: unknown[] = ["match", ["get", "_fill"]];
  for (const [bucket, name] of series.entries()) {
    expr.push(bucket, name);
  }
  expr.push(fallback);
  return expr;
}

interface NowProps {
  bucket: number;
  props: Record<string, string | number>;
}

export class TidesCurrentsLayer {
  private readonly map: maplibregl.Map;
  private readonly panel: FeatureInfoPanel;
  private enabled = false;
  private index: TidesIndex | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  /** Per-station display props, valid for one refresh bucket. */
  private readonly nowCache = new Map<string, NowProps>();
  private lastDataJson = "";

  /** Called when this layer opens its popup (so other popups can close). */
  onShowInfo?: () => void;

  constructor(map: maplibregl.Map) {
    this.map = map;
    this.enabled = getSettings().layerGroups.tidesCurrents ?? false;

    this.panel = new FeatureInfoPanel(map.getContainer());
    this.panel.onClose = () => this.panel.hide();

    map.on("style.load", () => this.setup());
    if (map.isStyleLoaded()) this.setup();

    map.on("moveend", () => {
      if (this.enabled) this.debouncedRebuild();
    });
    map.on("click", (e) => this.handleClick(e));

    let currentTheme = getSettings().displayTheme;
    let currentScheme = getSettings().symbologyScheme;
    let currentDetail = getSettings().detailLevel;
    let currentUnits = `${getSettings().depthUnit}/${getSettings().speedUnit}`;
    onSettingsChange((s) => {
      // Unit changes invalidate cached station labels
      const units = `${s.depthUnit}/${s.speedUnit}`;
      if (units !== currentUnits) {
        currentUnits = units;
        this.nowCache.clear();
        if (this.enabled) this.debouncedRebuild();
      }
      const nowEnabled = s.layerGroups.tidesCurrents ?? false;
      if (nowEnabled !== this.enabled) {
        this.enabled = nowEnabled;
        if (this.enabled) {
          this.rebuild();
        } else {
          this.clear();
          this.panel.hide();
        }
        this.updateRefreshTimer();
      }
      // Theme/scheme switches load a different sprite sheet, and detail
      // level moves the arrow min zoom; re-add layers to match.
      if (
        s.displayTheme !== currentTheme ||
        s.symbologyScheme !== currentScheme ||
        s.detailLevel !== currentDetail
      ) {
        currentTheme = s.displayTheme;
        currentScheme = s.symbologyScheme;
        currentDetail = s.detailLevel;
        if (this.map.isStyleLoaded()) {
          this.addSourceAndLayers();
          if (this.enabled) this.rebuild();
        }
        this.updateRefreshTimer();
      }
    });
    this.updateRefreshTimer();
  }

  /** Close the station popup (e.g. on idle auto-return). */
  hide(): void {
    this.panel.hide();
  }

  private setup(): void {
    this.addSourceAndLayers();
    if (this.enabled) this.rebuild();
  }

  private updateRefreshTimer(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (!this.enabled) return;
    const interval =
      getSettings().displayTheme === "eink" ? REFRESH_EINK_MS : REFRESH_MS;
    this.refreshTimer = setInterval(() => this.rebuild(), interval);
  }

  private removeLayers(): void {
    for (const id of [LAYER_TIDE, LAYER_CURRENT, LAYER_SLACK]) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    if (this.map.getSource(SOURCE_ID)) this.map.removeSource(SOURCE_ID);
  }

  private addSourceAndLayers(): void {
    this.removeLayers();
    this.lastDataJson = "";

    this.map.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    const { symbologyScheme, iconScale, textScale, detailLevel } =
      getSettings();
    const sprites = SPRITES[symbologyScheme] ?? SPRITES["pelorus-standard"];
    // Currents appear later than tide icons; their speed labels later still.
    // Above-standard detail brings both in one zoom level earlier.
    const arrowMinZoom = detailLevel >= 1 ? 10 : 11;
    const labelPaint = {
      "text-color": s52Colour("CHBLK"),
      "text-halo-color": s52Colour("CHWHT"),
      "text-halo-width": 1.2,
    };

    this.map.addLayer({
      id: LAYER_TIDE,
      type: "symbol",
      source: SOURCE_ID,
      minzoom: MIN_ZOOM,
      filter: ["==", ["get", "_kind"], "tide"],
      layout: {
        "icon-image": fillIconExpr(
          sprites.tideGauge,
          sprites.tideNeutral,
        ) as never,
        "icon-size": 0.9 * iconScale,
        "icon-allow-overlap": true,
        "text-field": ["get", "_label"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11 * textScale,
        "text-anchor": "top",
        "text-offset": [0, 1.1],
        "text-optional": true,
      },
      paint: labelPaint,
    });

    this.map.addLayer({
      id: LAYER_CURRENT,
      type: "symbol",
      source: SOURCE_ID,
      minzoom: arrowMinZoom,
      filter: [
        "all",
        ["==", ["get", "_kind"], "current"],
        ["!=", ["get", "_state"], "slack"],
      ],
      layout: {
        "icon-image": fillIconExpr(sprites.arrow, sprites.arrow[2]) as never,
        // Arrow length tracks drift: weak currents draw small, 3+ kt large.
        "icon-size": [
          "*",
          iconScale,
          ["interpolate", ["linear"], ["get", "_driftKn"], 0, 0.5, 3, 1.4],
        ],
        "icon-rotate": ["get", "_setDeg"],
        // Rotate with the map so arrows show true set in course-up mode.
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        // Speed labels appear one zoom level after the arrows themselves.
        "text-field": [
          "step",
          ["zoom"],
          "",
          arrowMinZoom + 1,
          ["get", "_label"],
        ],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11 * textScale,
        "text-anchor": "top",
        "text-offset": [0, 1.4],
        "text-optional": true,
      },
      paint: labelPaint,
    });

    // Slack stations: a small open circle instead of a direction arrow.
    this.map.addLayer({
      id: LAYER_SLACK,
      type: "circle",
      source: SOURCE_ID,
      minzoom: arrowMinZoom,
      filter: [
        "all",
        ["==", ["get", "_kind"], "current"],
        ["==", ["get", "_state"], "slack"],
      ],
      paint: {
        "circle-radius": 5 * iconScale,
        "circle-color": "transparent",
        "circle-stroke-color": s52Colour("CURSR"),
        "circle-stroke-width": 2,
      },
    });
  }

  private debouncedRebuild(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.rebuild(), 150);
  }

  private async ensureIndex(): Promise<TidesIndex | null> {
    if (this.index) return this.index;
    try {
      this.index = await loadTidesIndex();
    } catch (err) {
      console.warn("tides bundle unavailable:", err);
    }
    return this.index;
  }

  private async rebuild(): Promise<void> {
    if (!this.enabled) return;
    if (!this.map.getSource(SOURCE_ID)) {
      if (!this.map.isStyleLoaded()) return;
      this.addSourceAndLayers();
    }
    if (this.map.getZoom() < MIN_ZOOM) {
      this.clear();
      return;
    }
    const index = await this.ensureIndex();
    if (!index) return;

    const b = this.map.getBounds();
    const box = {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    };
    let tides = stationsInBounds(index.tideStations, box);
    let currents = stationsInBounds(index.currentStations, box);
    if (tides.length + currents.length > MAX_STATIONS) {
      tides = tides.filter(isTideRef);
      currents = currents.filter(isCurrentRef);
    }

    const now = new Date();
    const bucket = Math.floor(now.getTime() / REFRESH_MS);
    const features: Feature[] = [];
    for (const s of tides) {
      const props = this.tideProps(s, index, now, bucket);
      if (props) features.push(pointFeature(s.lng, s.lat, props));
    }
    for (const s of currents) {
      const props = this.currentProps(s, index, now, bucket);
      if (props) features.push(pointFeature(s.lng, s.lat, props));
    }

    const fc: FeatureCollection = { type: "FeatureCollection", features };
    // Skip the repaint when nothing visible changed (kind to e-ink).
    const json = JSON.stringify(fc);
    if (json === this.lastDataJson) return;
    this.lastDataJson = json;
    (this.map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource)?.setData(fc);
  }

  private tideProps(
    station: TideStation,
    index: TidesIndex,
    now: Date,
    bucket: number,
  ): Record<string, string | number> | null {
    const key = `t:${station.id}`;
    const cached = this.nowCache.get(key);
    if (cached && cached.bucket === bucket) return cached.props;

    const state = tideNow(station, index, now);
    if (!state) return null;
    const arrow = state.trend === "rising" ? "↑" : "↓";
    const label =
      state.heightMeters != null
        ? `${formatDepth(state.heightMeters, getSettings().depthUnit)} ${arrow}`
        : arrow;
    const props = {
      _kind: "tide",
      _id: station.id,
      _label: label,
      // Gauge bucket 0–4; -1 selects the neutral icon (subordinates)
      _fill: state.fraction != null ? Math.round(state.fraction * 4) : -1,
    };
    this.nowCache.set(key, { bucket, props });
    return props;
  }

  private currentProps(
    station: CurrentStation,
    index: TidesIndex,
    now: Date,
    bucket: number,
  ): Record<string, string | number> | null {
    const key = `c:${station.id}`;
    const cached = this.nowCache.get(key);
    if (cached && cached.bucket === bucket) return cached.props;

    const state = currentState(station, index, now, 1);
    if (!state) return null;
    const props = {
      _kind: "current",
      _id: station.id,
      _state: state.state,
      _setDeg: Math.round(state.dir),
      _driftKn: Number(state.speedKn.toFixed(2)),
      // Arrow fill bucket 0–4: speed relative to this cycle's max
      _fill:
        state.cycleMaxKn > 0
          ? Math.min(4, Math.round((state.speedKn / state.cycleMaxKn) * 4))
          : 0,
      _label:
        state.state === "slack"
          ? "slack"
          : formatSpeed(state.speedKn, getSettings().speedUnit),
    };
    this.nowCache.set(key, { bucket, props });
    return props;
  }

  private clear(): void {
    this.lastDataJson = "";
    const src = this.map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    src?.setData({ type: "FeatureCollection", features: [] });
  }

  // ── Click → upcoming-events popup ───────────────────────────────────

  private handleClick(e: maplibregl.MapMouseEvent): void {
    if (!this.enabled || getMode() !== "query") return;
    if (!this.map.getLayer(LAYER_TIDE)) return;

    const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
      [e.point.x - 10, e.point.y - 10],
      [e.point.x + 10, e.point.y + 10],
    ];
    const hits = this.map.queryRenderedFeatures(bbox, {
      layers: [LAYER_TIDE, LAYER_CURRENT, LAYER_SLACK],
    });
    const hit = hits[0];
    if (!hit) {
      this.panel.hide();
      return;
    }

    const id = hit.properties._id as string;
    const kind = hit.properties._kind as string;
    const info = kind === "tide" ? this.tideInfo(id) : this.currentInfo(id);
    if (!info) return;
    this.onShowInfo?.();
    this.panel.show(info, 0, 1);
  }

  private tideInfo(id: string): FeatureInfo | null {
    const index = this.index;
    const station = index?.tideStations.find((s) => s.id === id);
    if (!index || !station) return null;
    const now = new Date();
    const state = tideState(station, index, now, POPUP_WINDOW_HRS);
    if (!state) return null;

    const { depthUnit } = getSettings();
    const details: { label: string; value: string }[] = [];
    if (state.heightMeters != null) {
      details.push({
        label: "Now",
        value: `${formatTideHeight(state.heightMeters, depthUnit)} (${state.trend})`,
      });
    } else {
      details.push({ label: "Now", value: state.trend });
    }
    for (const ev of state.events) {
      details.push({
        label: formatEventTime(ev.time, now),
        value: formatTideEvent(ev, depthUnit),
      });
    }
    return { type: "Tide Station", name: station.name, details };
  }

  private currentInfo(id: string): FeatureInfo | null {
    const index = this.index;
    const station = index?.currentStations.find((s) => s.id === id);
    if (!index || !station) return null;
    const now = new Date();
    const state = currentState(station, index, now, POPUP_WINDOW_HRS);
    if (!state) return null;

    const { speedUnit } = getSettings();
    const details: { label: string; value: string }[] = [
      {
        label: "Now",
        value:
          state.state === "slack"
            ? "Slack"
            : `${capitalize(state.state)} ${formatSpeed(state.speedKn, speedUnit)} → ${Math.round(state.dir)}°`,
      },
      {
        label: "Flood / Ebb set",
        value: `${Math.round(station.floodDir)}° / ${Math.round(station.ebbDir)}°`,
      },
    ];
    for (const ev of state.events) {
      details.push({
        label: formatEventTime(ev.time, now),
        value: formatCurrentEvent(ev, speedUnit),
      });
    }
    return { type: "Current Station", name: station.name, details };
  }
}

function pointFeature(
  lng: number,
  lat: number,
  properties: Record<string, string | number>,
): Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
