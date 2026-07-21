/**
 * "Chart in use" readout + overscale badge.
 *
 * The auto-quilt shows the best chart per area without the user choosing one, so
 * (per ECDIS practice) we tell them which chart they're actually looking at and
 * warn when the view is zoomed in past that chart's compilation scale. The
 * active chart is determined from what's really rendered at the map centre:
 * vector ENC features take precedence (vector-preferred), otherwise the raster
 * chart whose footprint contains the centre.
 */

import type maplibregl from "maplibre-gl";
import { rasterChartAt } from "../chart/raster-charts";
import { depthUnitLabel, getSettings, onSettingsChange } from "../settings";
import { bearingModeLabel } from "../utils/magnetic";
import { recordScan } from "../utils/scan-perf";

function isEncFeature(f: maplibregl.MapGeoJSONFeature): boolean {
  return typeof f.source === "string" && f.source.startsWith("s57-vector");
}

export class ChartInUseReadout {
  private readonly map: maplibregl.Map;
  private readonly el: HTMLElement;
  /** Last-computed chart label + overscale state, so a units change can
   *  re-render without re-querying the map. */
  private chartLabel: string | null = null;
  private overscale = false;

  constructor(map: maplibregl.Map) {
    this.map = map;
    this.el = document.createElement("div");
    this.el.className = "chart-in-use";
    Object.assign(this.el.style, {
      position: "absolute",
      bottom: "8px",
      left: "50%",
      transform: "translateX(-50%)",
      font: "11px/1.2 system-ui, sans-serif",
      padding: "3px 8px",
      borderRadius: "4px",
      background: "rgba(0,0,0,0.6)",
      color: "#fff",
      pointerEvents: "none",
      whiteSpace: "nowrap",
      zIndex: "5",
    } satisfies Partial<CSSStyleDeclaration>);
    map.getContainer().appendChild(this.el);

    // Units live here now (leading segment), so the readout is always
    // shown — even over land with no chart — and re-renders on a units
    // change without waiting for the next map move.
    onSettingsChange(() => this.render());

    // Re-evaluate on move and whenever a source finishes loading tiles — the
    // map never goes fully "idle" here (vessel/overlay updates keep it busy),
    // so we can't wait on "idle" to know the chart tiles have arrived.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => this.update(), 150);
    };
    map.on("moveend", update);
    // Re-check when a CHART source finishes loading tiles (so ENC detection
    // sees the freshly-loaded fills). Ignore overlay (wind/tide) data events,
    // which fire constantly and would starve the debounce.
    map.on("data", (e) => {
      const sid = (e as { sourceId?: string }).sourceId;
      if (
        e.dataType === "source" &&
        typeof sid === "string" &&
        (sid.startsWith("s57-vector") || sid.startsWith("rnc-"))
      ) {
        update();
      }
    });
    this.update();
  }

  private update(): void {
    const blend = getSettings().chartBlend;
    const c = this.map.getCenter();
    const zoom = this.map.getZoom();
    const cx = Math.round(this.map.getCanvas().clientWidth / 2);
    const cy = Math.round(this.map.getCanvas().clientHeight / 2);
    // A small box (not a single pixel) so we reliably hit the ENC area fill
    // rather than landing between soundings/symbols.
    const box: [maplibregl.PointLike, maplibregl.PointLike] = [
      [cx - 5, cy - 5],
      [cx + 5, cy + 5],
    ];
    const rc = blend !== "vector" ? rasterChartAt(c.lng, c.lat) : null;
    const qrfStart = performance.now();
    const boxFeatures =
      blend !== "raster" ? this.map.queryRenderedFeatures(box) : [];
    recordScan("chart-in-use-qrf", qrfStart, boxFeatures.length);
    const encHere = blend !== "raster" && boxFeatures.some(isEncFeature);

    let label: string | null = null;
    let overscale = false;
    if (blend === "raster" && rc) {
      label = rncLabel(rc.id, rc.scale);
      overscale = zoom > rc.nativeZoom + 0.5;
    } else if (encHere) {
      label = "ENC · NOAA";
    } else if (rc) {
      label = rncLabel(rc.id, rc.scale);
      overscale = zoom > rc.nativeZoom + 0.5;
    }

    this.chartLabel = label;
    this.overscale = overscale;
    this.render();
  }

  /** Compose the always-on units segment with the current chart label. */
  private render(): void {
    const s = getSettings();
    const units = `${depthUnitLabel(s.depthUnit)} · °${bearingModeLabel(
      s.bearingMode,
    )}`;
    const chart = this.chartLabel
      ? this.overscale
        ? `${this.chartLabel} · OVERSCALE`
        : this.chartLabel
      : null;
    this.el.textContent = chart ? `${units}  ·  ${chart}` : units;
    this.el.style.background = this.overscale
      ? "rgba(200,120,0,0.85)"
      : "rgba(0,0,0,0.6)";
  }
}

function rncLabel(id: string, scale: number): string {
  return `RNC ${id.toUpperCase()} · 1:${Math.round(scale / 1000)}k`;
}
