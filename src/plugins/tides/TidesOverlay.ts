/**
 * Tides & currents map overlay (a MapOverlay plugin).
 *
 * Draws tide-station icons (height + rising/falling) and current arrows
 * (rotated to set, scaled by drift) from the bundled NOAA station data,
 * computing harmonic predictions client-side. Layers are placed into z-order
 * slots — tide gauges in `overlay-data` (above chart symbols), current arrows
 * in `overlay-low` (above soundings, below buoys/lights/labels). Picking and
 * the station popup go through the host's central dispatcher.
 *
 * Adapted from the former src/chart/TidesCurrentsLayer.ts; the prediction core
 * in src/tides/ is unchanged.
 */

import type { Feature, FeatureCollection } from "geojson";
import type maplibregl from "maplibre-gl";
import type { FeatureInfo } from "../../chart/feature-info";
import { s52Colour } from "../../chart/s52-colours";
import { formatDepth, type SymbologyScheme } from "../../settings";
import {
  type CurrentStation,
  isCurrentRef,
  isTideRef,
  loadTidesIndex,
  stationsInBounds,
  type TideStation,
  type TidesIndex,
} from "../../tides/bundle";
import { currentState } from "../../tides/currents";
import {
  formatCurrentEvent,
  formatEventTime,
  formatSpeed,
  formatTideEvent,
  formatTideHeight,
  formatTimeUntil,
} from "../../tides/format";
import { tideNow, tideState } from "../../tides/predictor";
import type { MapOverlay, PluginHost, PluginMap } from "../types";

export const TIDES_LAYER_GROUP = "tidesCurrents";

const SOURCE_ID = "_tides-currents";
const LAYER_TIDE = "_tide-stations";
const LAYER_CURRENT = "_current-arrows";
const LAYER_SLACK_FLOOD = "_current-slack-flood";
const LAYER_SLACK_EBB = "_current-slack-ebb";

/** All pickable tide/current layers, in priority order. */
export const TIDES_PICK_LAYERS = [
  LAYER_TIDE,
  LAYER_CURRENT,
  LAYER_SLACK_FLOOD,
  LAYER_SLACK_EBB,
];

const MIN_ZOOM = 9;
/** Cap on stations rendered at once; harmonic stations win when over. */
const MAX_STATIONS = 400;

/** Now-state refresh cadence; e-ink refreshes less often to avoid repaints. */
const REFRESH_MS = 5 * 60 * 1000;
const REFRESH_EINK_MS = 15 * 60 * 1000;

/** Hours of upcoming events to list in the station popup. */
const POPUP_WINDOW_HRS = 26;

interface SpriteSet {
  tideNeutral: string;
  tideGauge: string[];
  arrow: string[];
  slackArrow: string;
}

const NAUTICAL_SPRITES: SpriteSet = {
  tideNeutral: "ecdis-tide-station",
  tideGauge: [0, 1, 2, 3, 4].map((i) => `ecdis-tide-gauge-${i}`),
  arrow: [0, 1, 2, 3, 4].map((i) => `ecdis-current-arrow-${i}`),
  slackArrow: "ecdis-slack-arrow",
};

const SPRITES: Record<SymbologyScheme, SpriteSet> = {
  "pelorus-standard": NAUTICAL_SPRITES,
  "simplified-minimal": NAUTICAL_SPRITES,
  "iho-s52": {
    tideNeutral: "PELTID01",
    tideGauge: [0, 1, 2, 3, 4].map((i) => `PELTIDG${i}`),
    arrow: [1, 2, 3, 4, 5].map((i) => `PELCUR0${i}`),
    slackArrow: "PELSLK01",
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

export class TidesOverlay implements MapOverlay {
  readonly id = "tides-currents";

  private readonly host: PluginHost;
  private pmap: PluginMap | null = null;
  private index: TidesIndex | null = null;
  private enabled = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private timerOff: (() => void) | null = null;
  /** Per-station display props, valid for one refresh bucket. */
  private readonly nowCache = new Map<string, NowProps>();
  private lastDataJson = "";

  constructor(host: PluginHost) {
    this.host = host;
    this.enabled = host.settings.isLayerGroupEnabled(TIDES_LAYER_GROUP);

    // Map moves refresh the in-bounds station set (debounced by the host).
    host.events.onMapMove(() => {
      if (this.enabled) this.rebuild();
    }, 150);

    // Unit changes don't rebuild the chart style, so handle them here.
    let units = unitKey(host);
    host.settings.onChange(() => {
      const next = unitKey(host);
      if (next !== units) {
        units = next;
        this.nowCache.clear();
        if (this.enabled) this.debouncedRebuild();
      }
    });
  }

  /** (Re-)add source and layers; called on every style load by the host. */
  setup(map: PluginMap): void {
    this.pmap = map;
    this.lastDataJson = "";

    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    const s = this.host.settings.get();
    const sprites = SPRITES[s.symbologyScheme] ?? SPRITES["pelorus-standard"];
    const iconScale = s.iconScale;
    const textScale = s.textScale;
    // Arrows appear one zoom after tide icons; speed labels one later still.
    // Above-standard detail brings both in one zoom level earlier.
    const arrowMinZoom = s.detailLevel >= 1 ? 9 : 10;
    const labelPaint = {
      "text-color": s52Colour("CHBLK"),
      "text-halo-color": s52Colour("CHWHT"),
      "text-halo-width": 1.2,
    };

    // Tide gauges sit above chart symbols (overlay-data).
    map.addLayer(
      {
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
          "text-offset": [0, 0.85],
          "text-optional": true,
        },
        paint: labelPaint,
      },
      "overlay-data",
    );

    // Current arrows are LOW priority: above soundings, below buoys/lights/
    // labels, and excluded from symbol collision so they never displace chart
    // symbols. The `overlay-low` slot anchors them just above soundings.
    map.addLayer(
      {
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
          // Arrow length tracks drift; sprites rendered 2× and drawn at half
          // scale so the largest arrows are downsampled (sharp), never upsampled.
          "icon-size": [
            "*",
            iconScale * 0.5,
            ["interpolate", ["linear"], ["get", "_driftKn"], 0, 0.5, 3, 1.4],
          ],
          "icon-rotate": ["get", "_setDeg"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
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
          "text-offset": [0, 1.1],
          "text-optional": true,
        },
        paint: labelPaint,
      },
      "overlay-low",
    );

    // Slack stations: two tail-anchored arrows radiating in the station's
    // flood and ebb sets (often not 180° apart) — a fixed-size double-arrow.
    for (const [id, dirProp] of [
      [LAYER_SLACK_FLOOD, "_floodDeg"],
      [LAYER_SLACK_EBB, "_ebbDeg"],
    ] as const) {
      map.addLayer(
        {
          id,
          type: "symbol",
          source: SOURCE_ID,
          minzoom: arrowMinZoom,
          filter: [
            "all",
            ["==", ["get", "_kind"], "current"],
            ["==", ["get", "_state"], "slack"],
          ],
          layout: {
            "icon-image": sprites.slackArrow,
            "icon-size": 0.5 * 0.55 * iconScale,
            "icon-rotate": ["get", dirProp],
            "icon-rotation-alignment": "map",
            "icon-anchor": "bottom",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        },
        "overlay-low",
      );
    }
  }

  /** Re-evaluate enabled state, refresh timer, and station data. */
  update(): void {
    this.enabled = this.host.settings.isLayerGroupEnabled(TIDES_LAYER_GROUP);
    this.updateRefreshTimer();
    if (this.enabled) {
      this.rebuild();
    } else {
      this.clear();
    }
  }

  destroy(): void {
    this.timerOff?.();
    this.timerOff = null;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  private updateRefreshTimer(): void {
    this.timerOff?.();
    this.timerOff = null;
    if (!this.enabled) return;
    const interval =
      this.host.settings.get().displayTheme === "eink"
        ? REFRESH_EINK_MS
        : REFRESH_MS;
    this.timerOff = this.host.events.onTimeTick(() => this.rebuild(), interval);
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
    const pmap = this.pmap;
    if (!this.enabled || !pmap) return;
    const map = pmap.raw;
    if (!pmap.hasSource(SOURCE_ID)) {
      if (!map.isStyleLoaded()) return;
      this.setup(pmap);
    }
    if (map.getZoom() < MIN_ZOOM) {
      this.clear();
      return;
    }
    const index = await this.ensureIndex();
    if (!index) return;

    const b = map.getBounds();
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
    const json = JSON.stringify(fc);
    if (json === this.lastDataJson) return;
    this.lastDataJson = json;
    (map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource)?.setData(fc);
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
    const unit = this.host.settings.get().depthUnit;
    // Secondary (subordinate) stations have approximate heights; that's shown
    // in the popup, not flagged on the cramped icon label (a "~" there reads
    // as a minus sign at small sizes).
    const label =
      state.heightMeters != null
        ? `${formatDepth(state.heightMeters, unit)} ${arrow}`
        : arrow;
    const props = {
      _kind: "tide",
      _id: station.id,
      _label: label,
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
      _floodDeg: Math.round(station.floodDir),
      _ebbDeg: Math.round(station.ebbDir),
      _driftKn: Number(state.speedKn.toFixed(2)),
      _fill:
        state.cycleMaxKn > 0
          ? Math.min(4, Math.round((state.speedKn / state.cycleMaxKn) * 4))
          : 0,
      _label:
        state.state === "slack"
          ? "slack"
          : formatSpeed(state.speedKn, this.host.settings.get().speedUnit),
    };
    this.nowCache.set(key, { bucket, props });
    return props;
  }

  private clear(): void {
    this.lastDataJson = "";
    const src = this.pmap?.raw.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    src?.setData({ type: "FeatureCollection", features: [] });
  }

  /** Map a clicked station feature to an upcoming-events popup. */
  resolveInfo(feature: maplibregl.MapGeoJSONFeature): FeatureInfo | null {
    const id = feature.properties._id as string;
    const kind = feature.properties._kind as string;
    return kind === "tide" ? this.tideInfo(id) : this.currentInfo(id);
  }

  private tideInfo(id: string): FeatureInfo | null {
    const index = this.index;
    const station = index?.tideStations.find((s) => s.id === id);
    if (!index || !station) return null;
    const now = new Date();
    const state = tideState(station, index, now, POPUP_WINDOW_HRS);
    if (!state) return null;

    const { depthUnit } = this.host.settings.get();
    const details: { label: string; value: string }[] = [];
    if (state.heightMeters != null) {
      details.push({
        label: "Now",
        value: `${formatTideHeight(state.heightMeters, depthUnit)} (${state.trend})`,
      });
    } else {
      details.push({ label: "Now", value: state.trend });
    }
    state.events.forEach((ev, i) => {
      details.push({
        label:
          i === 0
            ? `${formatEventTime(ev.time, now)} ${formatTimeUntil(ev.time, now)}`
            : formatEventTime(ev.time, now),
        value: formatTideEvent(ev, depthUnit),
      });
    });
    // Subordinate stations carry NOAA offset-derived (approximate) predictions.
    const type = state.approximate
      ? "Tide Station (secondary)"
      : "Tide Station";
    return { type, name: station.name, details };
  }

  private currentInfo(id: string): FeatureInfo | null {
    const index = this.index;
    const station = index?.currentStations.find((s) => s.id === id);
    if (!index || !station) return null;
    const now = new Date();
    const state = currentState(station, index, now, POPUP_WINDOW_HRS);
    if (!state) return null;

    const { speedUnit } = this.host.settings.get();
    const details: FeatureInfo["details"] = [
      state.state === "slack"
        ? { label: "Now", value: "Slack" }
        : {
            label: "Now",
            value: `${capitalize(state.state)} ${formatSpeed(state.speedKn, speedUnit)} ${Math.round(state.dir)}°`,
            dir: state.dir,
          },
    ];
    state.events.forEach((ev, i) => {
      details.push({
        label:
          i === 0
            ? `${formatEventTime(ev.time, now)} ${formatTimeUntil(ev.time, now)}`
            : formatEventTime(ev.time, now),
        value: formatCurrentEvent(ev, speedUnit),
        ...(ev.type === "maxFlood"
          ? { dir: station.floodDir }
          : ev.type === "maxEbb"
            ? { dir: station.ebbDir }
            : {}),
      });
    });
    return { type: "Current Station", name: station.name, details };
  }
}

function unitKey(host: PluginHost): string {
  const s = host.settings.get();
  return `${s.depthUnit}/${s.speedUnit}`;
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
