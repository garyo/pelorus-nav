/**
 * Anchor-watch chart rendering: watch circle, warning ring, anchor marker,
 * and swing scatter. Pure display — detection, alarm logic, and state live
 * in the anchor manager; this class draws whatever state it is handed via
 * `update()` and hides everything on `update(null)`.
 *
 * Zone state colours the watch circle (S-52 tokens, so day/dusk/night adapt);
 * on e-ink the zone reads from line weight and dash instead of hue, and
 * geometry repaints (setData) are throttled to one per 30 s so the per-fix
 * scatter stream doesn't force continuous full-screen refreshes. Zone changes
 * and geometry edits (anchor drag, radius change) always repaint immediately.
 */

import type * as maplibregl from "maplibre-gl";
import {
  type ColourScheme,
  s52Colour,
  themeToColourScheme,
} from "../chart/s52-colours";
import { getSettings } from "../settings";
import { geodesicCircleGeoJSON } from "../vessel/accuracy-circle";
import { belowVesselLayerId } from "./layer-order";

const SRC_CIRCLE = "_anchor-watch-circle";
const SRC_RING = "_anchor-watch-ring";
const SRC_POINT = "_anchor-watch-point";
const SRC_SCATTER = "_anchor-watch-scatter";

const LYR_FILL = "_anchor-watch-fill";
const LYR_OUTLINE = "_anchor-watch-outline";
const LYR_RING = "_anchor-watch-ring";
const LYR_SCATTER = "_anchor-watch-scatter";
const LYR_ICON = "_anchor-watch-icon";

const ICON_NAME = "_anchor-watch-anchor";
const ICON_SIZE = 30;

const SOLID: [number, number] = [1, 0];

export type AnchorZone = "ok" | "warn" | "outside" | "gray";

export interface AnchorLayerState {
  anchor: { lat: number; lon: number };
  /** Watch (alarm) radius in meters. */
  radiusM: number;
  /** Warning band width in meters — the warning ring draws at radiusM − warnM. */
  warnM: number;
  zone: AnchorZone;
  /** Recent fixes since arming, oldest first. */
  scatter: readonly { lat: number; lon: number }[];
}

// --- Pure helpers (exported for unit tests) ---

export interface AnchorZonePaint {
  outlineColor: string;
  outlineWidth: number;
  /** line-dasharray; [1, 0] draws solid. */
  outlineDash: [number, number];
  fillColor: string;
  fillOpacity: number;
}

const ZONE_TOKENS: Record<AnchorZone, string> = {
  ok: "UINFG",
  warn: "CHYLW",
  outside: "UINFR",
  gray: "CHGRF",
};

/** Watch-circle paint for a zone state under a given S-52 colour scheme. */
export function anchorZonePaint(
  zone: AnchorZone,
  scheme: ColourScheme,
): AnchorZonePaint {
  if (scheme === "EINK") {
    // Greyscale panel: the zone reads from weight and dash, not hue.
    // "outside" is unmistakably heavy; "gray" (no GPS) is dashed.
    return {
      outlineColor: "#000000",
      outlineWidth: zone === "outside" ? 7 : zone === "warn" ? 4 : 2,
      outlineDash: zone === "gray" ? [2, 2] : SOLID,
      fillColor: "#000000",
      fillOpacity: 0,
    };
  }
  const color = s52Colour(ZONE_TOKENS[zone], scheme);
  return {
    outlineColor: color,
    outlineWidth: zone === "outside" ? 4 : zone === "warn" ? 3 : 2.5,
    outlineDash: zone === "gray" ? [2, 2] : SOLID,
    fillColor: color,
    fillOpacity:
      zone === "outside"
        ? 0.12
        : zone === "warn"
          ? 0.1
          : zone === "gray"
            ? 0.06
            : 0.08,
  };
}

/** E-ink repaint throttle — full-screen refreshes must stay rare. */
export const EINK_GEOMETRY_MIN_INTERVAL_MS = 30_000;

/**
 * Whether a geometry setData may go through now. Non-e-ink always writes;
 * e-ink writes immediately for `immediate` changes (zone change, geometry
 * edit, first paint) and otherwise at most once per interval.
 */
export function shouldWriteGeometry(
  eink: boolean,
  immediate: boolean,
  nowMs: number,
  lastWriteMs: number | null,
): boolean {
  if (!eink || immediate || lastWriteMs === null) return true;
  return nowMs - lastWriteMs >= EINK_GEOMETRY_MIN_INTERVAL_MS;
}

/**
 * Lowest route/waypoint overlay layer among the given style layer ids, so
 * anchor graphics insert beneath every route line and waypoint marker.
 */
export function firstRouteOrWaypointLayerId(
  layerIds: readonly string[],
): string | undefined {
  return layerIds.find(
    (id) => id.startsWith("_route-") || id.startsWith("_waypoint"),
  );
}

// --- The layer ---

export class AnchorLayer {
  private readonly map: maplibregl.Map;
  private state: AnchorLayerState | null = null;
  /** Zone whose paint properties are currently applied to the layers. */
  private appliedZone: AnchorZone | null = null;
  private lastGeometryWriteMs: number | null = null;

  constructor(map: maplibregl.Map) {
    this.map = map;
    map.on("style.load", () => this.setupLayers());
    if (map.isStyleLoaded()) this.setupLayers();
  }

  /** Render the given watch state; null hides everything. */
  update(state: AnchorLayerState | null): void {
    const prev = this.state;
    this.state = state;
    this.applyState(prev);
  }

  private setupLayers(): void {
    this.createAnchorIcon();
    this.addSources();
    this.addLayers();
    // The rebuilt style starts with empty sources and default paint — repaint
    // both from the retained state (the MeasurementLayer lesson).
    this.appliedZone = null;
    this.lastGeometryWriteMs = null;
    if (this.state) this.applyState(null);
  }

  private addSources(): void {
    if (this.map.getSource(SRC_CIRCLE)) return;
    for (const id of [SRC_CIRCLE, SRC_RING, SRC_POINT, SRC_SCATTER]) {
      this.map.addSource(id, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }
  }

  private addLayers(): void {
    if (this.map.getLayer(LYR_FILL)) return;

    const eink = getSettings().displayTheme === "eink";
    const scheme = themeToColourScheme(getSettings().displayTheme);
    // Gray until the first update() applies the real zone — armed rendering
    // always starts from a fresh applyState, so this never shows on its own.
    const paint = anchorZonePaint("gray", scheme);
    const beforeId = this.beforeId();

    this.map.addLayer(
      {
        id: LYR_FILL,
        type: "fill",
        source: SRC_CIRCLE,
        paint: {
          "fill-color": paint.fillColor,
          "fill-opacity": paint.fillOpacity,
        },
      },
      beforeId,
    );

    this.map.addLayer(
      {
        id: LYR_OUTLINE,
        type: "line",
        source: SRC_CIRCLE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": paint.outlineColor,
          "line-width": paint.outlineWidth,
          "line-dasharray": paint.outlineDash,
        },
      },
      beforeId,
    );

    // Warning ring: fixed thin/dashed yellow (black on e-ink) — it marks the
    // warning threshold, and doesn't change with zone state.
    this.map.addLayer(
      {
        id: LYR_RING,
        type: "line",
        source: SRC_RING,
        paint: eink
          ? {
              "line-color": "#000000",
              "line-width": 1,
              "line-dasharray": [4, 3],
            }
          : {
              "line-color": s52Colour("CHYLW", scheme),
              "line-width": 1.5,
              "line-dasharray": [3, 3],
              "line-opacity": 0.8,
            },
      },
      beforeId,
    );

    this.map.addLayer(
      {
        id: LYR_SCATTER,
        type: "circle",
        source: SRC_SCATTER,
        paint: {
          "circle-radius": eink ? 2 : 2.5,
          "circle-color": eink ? "#000000" : s52Colour("UINFB", scheme),
          "circle-opacity": eink ? 0.45 : 0.5,
        },
      },
      beforeId,
    );

    this.map.addLayer(
      {
        id: LYR_ICON,
        type: "symbol",
        source: SRC_POINT,
        layout: {
          "icon-image": ICON_NAME,
          "icon-size": 1,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      },
      beforeId,
    );
  }

  /**
   * Anchor graphics sit below route/waypoint overlays, which in turn sit
   * below the vessel stack (layer-order.ts). Overlays added later insert
   * at belowVesselLayerId and therefore land above these layers anyway.
   */
  private beforeId(): string | undefined {
    const layers = this.map.getStyle()?.layers ?? [];
    return (
      firstRouteOrWaypointLayerId(layers.map((l) => l.id)) ??
      belowVesselLayerId(this.map)
    );
  }

  private applyState(prev: AnchorLayerState | null): void {
    const state = this.state;
    if (!this.map.getSource(SRC_CIRCLE)) return; // setupLayers repaints later

    if (!state) {
      if (prev) this.clearSources();
      this.lastGeometryWriteMs = null;
      return;
    }

    if (state.zone !== this.appliedZone) {
      this.applyZonePaint(state.zone);
      this.appliedZone = state.zone;
    }

    const eink = getSettings().displayTheme === "eink";
    // Zone transitions and geometry edits (anchor drag, radius change) must
    // show at once; only the steady per-fix scatter stream is throttled.
    const immediate =
      !prev ||
      prev.zone !== state.zone ||
      prev.anchor.lat !== state.anchor.lat ||
      prev.anchor.lon !== state.anchor.lon ||
      prev.radiusM !== state.radiusM ||
      prev.warnM !== state.warnM;
    if (
      !shouldWriteGeometry(
        eink,
        immediate,
        Date.now(),
        this.lastGeometryWriteMs,
      )
    ) {
      return; // retained state catches up on the next allowed write
    }
    this.writeGeometry(state);
    this.lastGeometryWriteMs = Date.now();
  }

  private applyZonePaint(zone: AnchorZone): void {
    if (!this.map.getLayer(LYR_OUTLINE)) return;
    const paint = anchorZonePaint(
      zone,
      themeToColourScheme(getSettings().displayTheme),
    );
    this.map.setPaintProperty(LYR_OUTLINE, "line-color", paint.outlineColor);
    this.map.setPaintProperty(LYR_OUTLINE, "line-width", paint.outlineWidth);
    this.map.setPaintProperty(LYR_OUTLINE, "line-dasharray", paint.outlineDash);
    this.map.setPaintProperty(LYR_FILL, "fill-color", paint.fillColor);
    this.map.setPaintProperty(LYR_FILL, "fill-opacity", paint.fillOpacity);
  }

  private writeGeometry(state: AnchorLayerState): void {
    const { anchor, radiusM, warnM, scatter } = state;

    this.setSourceData(
      SRC_CIRCLE,
      radiusM > 0
        ? [geodesicCircleGeoJSON(anchor.lat, anchor.lon, radiusM)]
        : [],
    );

    const ringRadiusM = radiusM - warnM;
    this.setSourceData(
      SRC_RING,
      warnM > 0 && ringRadiusM > 0
        ? [geodesicCircleGeoJSON(anchor.lat, anchor.lon, ringRadiusM)]
        : [],
    );

    this.setSourceData(SRC_POINT, [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [anchor.lon, anchor.lat] },
      },
    ]);

    this.setSourceData(
      SRC_SCATTER,
      scatter.map((p) => ({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
      })),
    );
  }

  private clearSources(): void {
    for (const id of [SRC_CIRCLE, SRC_RING, SRC_POINT, SRC_SCATTER]) {
      this.setSourceData(id, []);
    }
  }

  private setSourceData(id: string, features: GeoJSON.Feature[]): void {
    const src = this.map.getSource(id) as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features });
  }

  /**
   * Canvas-drawn anchor glyph, cased for contrast like the vessel icon:
   * dark-on-light for day/e-ink, light-on-dark for dusk/night. E-ink gets a
   * larger, heavier stroke (the VesselLayer treatment).
   */
  private createAnchorIcon(): void {
    const theme = getSettings().displayTheme;
    const eink = theme === "eink";
    const dark = theme === "dusk" || theme === "night";
    const scale = eink ? 1.3 : 1;

    const canvas = document.createElement("canvas");
    const ratio = window.devicePixelRatio || 1;
    const px = Math.round(ICON_SIZE * scale * ratio);
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio * scale, ratio * scale);

    const cx = ICON_SIZE / 2;
    const trace = (): void => {
      ctx.beginPath();
      ctx.arc(cx, 6.5, 2.8, 0, Math.PI * 2); // ring
      ctx.moveTo(cx, 9.3);
      ctx.lineTo(cx, 24.5); // shaft
      ctx.moveTo(cx - 5, 12.5);
      ctx.lineTo(cx + 5, 12.5); // stock
      // Arms: arc through the shaft's foot, tips curving up each side.
      const a0 = 0.15 * Math.PI;
      const armR = 8;
      ctx.moveTo(cx + armR * Math.cos(a0), 16.5 + armR * Math.sin(a0));
      ctx.arc(cx, 16.5, armR, a0, Math.PI - a0);
    };

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    trace();
    ctx.strokeStyle = dark ? "#000000" : "#ffffff";
    ctx.lineWidth = eink ? 6 : 5;
    ctx.stroke();
    trace();
    ctx.strokeStyle = dark ? "#ffffff" : "#000000";
    ctx.lineWidth = eink ? 3 : 2.5;
    ctx.stroke();

    if (this.map.hasImage(ICON_NAME)) this.map.removeImage(ICON_NAME);
    this.map.addImage(
      ICON_NAME,
      { width: px, height: px, data: ctx.getImageData(0, 0, px, px).data },
      { pixelRatio: ratio },
    );
  }
}
