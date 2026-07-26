/**
 * "Chart in use" readout + overscale badge.
 *
 * The auto-quilt shows the best chart per area without the user choosing one, so
 * (per ECDIS practice) we tell them which chart they're actually looking at and
 * warn when the view is zoomed in past that chart's compilation scale. The
 * active chart is determined from what's really rendered at the map centre:
 * vector ENC features take precedence (vector-preferred), otherwise the raster
 * chart whose footprint contains the centre.
 *
 * Also carries a leading status segment — this pill is always visible,
 * unlike the top bar (collapsed into the hamburger menu on phones), so it's
 * where load/connectivity state belongs:
 * - Tiles still arriving → amber "LOADING CHARTS…": on a slow connection
 *   the basemap paints long before the chart detail, and the user must
 *   know not to trust the bare-looking water yet. Outranks the failure
 *   warning: during a slow Retry the honest state is "loading", and the
 *   error re-asserts only if it survives the loading settling. (On a dead
 *   network failures settle in milliseconds — the loading debounce never
 *   trips, so the red warning stays stable.)
 * - Tiles failing to load (per ChartLoadMonitor) → red warning, "OFFLINE"
 *   when the browser is offline, "TILE LOAD ERROR" otherwise. The chart on
 *   screen is wrong; tapping the segment (re)opens the explanation banner.
 * - Offline with nothing failing → muted "OFFLINE" note: business as usual
 *   when regions are downloaded.
 */

import type maplibregl from "maplibre-gl";
import type { ChartLoadStatus } from "../chart/ChartLoadMonitor";
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
  private offline = !navigator.onLine;
  private chartsLoading = false;
  private loadingDebounce: ReturnType<typeof setTimeout> | null = null;
  private readonly loadStatus?: ChartLoadStatus;

  constructor(map: maplibregl.Map, loadStatus?: ChartLoadStatus) {
    this.map = map;
    this.loadStatus = loadStatus;
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

    const onConnectivity = () => {
      this.offline = !navigator.onLine;
      this.render();
    };
    window.addEventListener("online", onConnectivity);
    window.addEventListener("offline", onConnectivity);
    loadStatus?.subscribe(() => this.render());

    // "Loading Charts…" while tiles are still arriving. Debounced on the
    // way in (a quick pan on a fast connection shouldn't flash the note),
    // instant on the way out. areTilesLoaded counts errored tiles as done,
    // so a failure can't wedge this in the loading state.
    const checkTilesLoaded = () => {
      if (map.areTilesLoaded()) {
        if (this.loadingDebounce) {
          clearTimeout(this.loadingDebounce);
          this.loadingDebounce = null;
        }
        if (this.chartsLoading) {
          this.chartsLoading = false;
          this.render();
        }
      } else if (!this.chartsLoading && !this.loadingDebounce) {
        this.loadingDebounce = setTimeout(() => {
          this.loadingDebounce = null;
          if (!this.map.areTilesLoaded()) {
            this.chartsLoading = true;
            this.render();
          }
        }, 400);
      }
    };
    // Coalesce the per-event checks: areTilesLoaded scans every source
    // cache, and a zoomed-out tile burst (all regions in view) fires
    // hundreds of dataloading/sourcedata events per second.
    let checkQueued = false;
    const queueCheck = () => {
      if (checkQueued) return;
      checkQueued = true;
      setTimeout(() => {
        checkQueued = false;
        checkTilesLoaded();
      }, 200);
    };
    map.on("dataloading", queueCheck);
    map.on("sourcedata", queueCheck);
    map.on("moveend", queueCheck);
    // idle is rare and definitive — check immediately.
    map.on("idle", checkTilesLoaded);

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
    const text = chart ? `${units}  ·  ${chart}` : units;
    this.el.textContent = "";
    const failure = this.loadStatus?.current() ?? null;
    if (this.chartsLoading) {
      // Chart detail hasn't all arrived — don't trust bare-looking water.
      // Shown even while failures stand: during a slow Retry "loading" is
      // the honest state, and the warning re-asserts if it survives.
      const loading = document.createElement("span");
      loading.textContent = "LOADING CHARTS…";
      Object.assign(loading.style, { color: "#ffd75e", fontWeight: "600" });
      this.el.append(loading, `  ·  ${text}`);
    } else if (failure) {
      // Tiles are failing — the chart on screen is wrong. Red warning;
      // tapping it (re)opens the explanation banner.
      const warn = document.createElement("span");
      warn.textContent = this.offline
        ? "OFFLINE: MISSING CHARTS"
        : "TILE LOAD ERROR";
      Object.assign(warn.style, {
        color: "#ff5555",
        fontWeight: "700",
        pointerEvents: "auto",
        cursor: "pointer",
      });
      warn.title = "Tiles failed to load — tap for details";
      warn.addEventListener("click", () => this.loadStatus?.reshowBanner());
      this.el.append(warn, `  ·  ${text}`);
    } else if (this.offline) {
      // A quiet note, not an alarm — dimmer than the rest of the pill.
      const off = document.createElement("span");
      off.textContent = "OFFLINE";
      off.style.opacity = "0.65";
      this.el.append(off, `  ·  ${text}`);
    } else {
      this.el.textContent = text;
    }
    this.el.style.background = this.overscale
      ? "rgba(200,120,0,0.85)"
      : "rgba(0,0,0,0.6)";
  }
}

function rncLabel(id: string, scale: number): string {
  return `RNC ${id.toUpperCase()} · 1:${Math.round(scale / 1000)}k`;
}
