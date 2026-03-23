/**
 * Safety contour — finds the shallowest depth contour ≥ safetyDepth
 * and bolds it by updating a MapLibre filter at runtime.
 *
 * Follows the same algorithm as OpenCPN's BuildDepthContourArray() +
 * SetSafetyContour() (s57chart.cpp): scan DEPCNT features for unique
 * VALDCO values, pick the smallest ≥ safetyDepth, bold that line.
 */
import type maplibregl from "maplibre-gl";
import { CHART_REGIONS } from "../data/chart-catalog";
import { getSettings, onSettingsChange } from "../settings";
import { s52Colour } from "./s52-colours";

/** All region-prefixed safety contour layer IDs. */
function getSafetyContourLayerIds(): string[] {
  return CHART_REGIONS.map((r) => `s57-${r.id}-depcnt-safety`);
}

/** All region-prefixed sounding layer IDs. */
function getSoundingLayerIds(): string[] {
  return CHART_REGIONS.map((r) => `s57-${r.id}-soundg`);
}

function getVectorSourceIds(): string[] {
  return CHART_REGIONS.map((r, i) =>
    i === 0 ? "s57-vector" : `s57-vector-${r.id}`,
  );
}

export class SafetyContour {
  private readonly map: maplibregl.Map;
  private resolvedValue: number | null = null;
  private prevSafetyDepth: number;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  /** Cached sorted array of all unique VALDCO values from loaded tiles. */
  private knownValdco: number[] = [];
  /** Suppress sourcedata re-scans during our own paint updates. */
  private updating = false;

  constructor(map: maplibregl.Map) {
    this.map = map;
    this.prevSafetyDepth = getSettings().safetyDepth;

    // Re-scan tile data when genuinely new tiles arrive
    map.on("sourcedata", (e) => {
      if (e.sourceDataType === "content" && !this.updating) {
        this.debouncedScan();
      }
    });

    // Re-apply filter after style rebuild (ChartManager resets layers to placeholder)
    map.on("styledata", () => {
      this.reapplyFilter();
    });

    // When safetyDepth changes, resolve from cache (instant) + update sounding colors
    onSettingsChange((s) => {
      if (s.safetyDepth !== this.prevSafetyDepth) {
        this.prevSafetyDepth = s.safetyDepth;
        this.resolveFromCache(s.safetyDepth);
        this.updating = true;
        this.updateSoundingColors(s.safetyDepth);
        this.updating = false;
      }
    });

    // Initial scan once map is loaded
    map.on("load", () => {
      this.scanTiles();
    });
  }

  /** Debounced tile scan — only re-queries features at most once per 1s. */
  private debouncedScan(): void {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => {
      this.scanTiles();
    }, 1000);
  }

  /** Scan all loaded DEPCNT features and cache unique VALDCO values. */
  private scanTiles(): void {
    const valdcoSet = new Set<number>();

    for (const srcId of getVectorSourceIds()) {
      try {
        const features = this.map.querySourceFeatures(srcId, {
          sourceLayer: "DEPCNT",
        });
        for (const f of features) {
          const v = f.properties?.VALDCO;
          if (typeof v === "number" && v > 0) {
            valdcoSet.add(v);
          }
        }
      } catch {
        // Source may not be loaded yet
      }
    }

    this.knownValdco = [...valdcoSet].sort((a, b) => a - b);
    this.resolveFromCache(getSettings().safetyDepth);
  }

  /** Pick the smallest cached VALDCO >= safetyDepth and update the filter. */
  private resolveFromCache(safetyDepth: number): void {
    const newValue = this.knownValdco.find((v) => v >= safetyDepth) ?? null;

    if (newValue === this.resolvedValue) return;
    this.resolvedValue = newValue;
    this.applyFilter();
  }

  /** Update sounding text color based on safetyDepth (avoids full style rebuild). */
  private updateSoundingColors(safetyDepth: number): void {
    const colorExpr = [
      "case",
      ["<=", ["get", "DEPTH"], safetyDepth],
      s52Colour("SNDG2"),
      s52Colour("SNDG1"),
    ];
    for (const layerId of getSoundingLayerIds()) {
      try {
        if (this.map.getLayer(layerId)) {
          this.map.setPaintProperty(layerId, "text-color", colorExpr);
        }
      } catch {
        // Layer may not exist yet
      }
    }
  }

  /** Re-apply the current filter after a style rebuild resets layers to placeholder. */
  private reapplyFilter(): void {
    if (this.resolvedValue !== null) {
      this.applyFilter();
    }
  }

  /** Update the filter on all safety contour layers to match the resolved VALDCO. */
  private applyFilter(): void {
    const filterValue = this.resolvedValue ?? -1; // -1 = impossible match
    const layerIds = getSafetyContourLayerIds();

    for (const layerId of layerIds) {
      try {
        const exists = !!this.map.getLayer(layerId);
        console.log(
          `[SafetyContour] setFilter(${layerId}, VALDCO==${filterValue}), layer exists=${exists}`,
        );
        if (exists) {
          this.map.setFilter(layerId, ["==", ["get", "VALDCO"], filterValue]);
        }
      } catch (err) {
        console.warn(`[SafetyContour] setFilter(${layerId}) failed:`, err);
      }
    }
  }
}
