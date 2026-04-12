/**
 * Safety contour — finds the shallowest depth contour ≥ safetyDepth
 * and bolds it by updating a MapLibre filter at runtime.
 *
 * Different ENC cells have different contour sets (e.g., inner harbor
 * has 1,2,3,5,7,10m; outer harbor has 5,10,20,30m). We resolve the
 * safety contour independently per `_cell_id` (source ENC cell), then
 * build a single MapLibre `match` expression that picks the correct
 * VALDCO for each feature's cell.
 *
 * Based on OpenCPN's BuildDepthContourArray() + SetSafetyContour().
 */

import type maplibregl from "maplibre-gl";
import type { FilterSpecification } from "maplibre-gl";
import { getRegionLayerIds, getVectorSourceIds } from "../data/chart-catalog";
import { getSettings, onSettingsChange } from "../settings";
import { s52Colour } from "./s52-colours";

const ISOLATED_DANGER_SUFFIXES = [
  "wrecks-isodgr",
  "obstrn-isodgr",
  "uwtroc-isodgr",
];

/** Apply a callback to each existing MapLibre layer matching the given IDs. */
function forEachLayer(
  map: maplibregl.Map,
  layerIds: string[],
  fn: (layerId: string) => void,
): void {
  for (const id of layerIds) {
    try {
      if (map.getLayer(id)) fn(id);
    } catch {
      // Layer may not exist yet during style transitions
    }
  }
}

export class SafetyContour {
  private readonly map: maplibregl.Map;
  private prevSafetyDepth: number;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  /** Cached sorted VALDCO values grouped by _cell_id. */
  private valdcoByCell = new Map<number, number[]>();
  /** Current per-cell resolved safety contour values. */
  private resolvedByCell = new Map<number, number>();
  /** Suppress sourcedata re-scans during our own paint updates. */
  private updating = false;
  /** Throttled safety depth update — max one apply per THROTTLE_MS. */
  private pendingSafetyDepth: number | null = null;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly THROTTLE_MS = 250;

  constructor(map: maplibregl.Map) {
    this.map = map;
    this.prevSafetyDepth = getSettings().safetyDepth;

    // Re-scan tile data when genuinely new tiles arrive
    map.on("sourcedata", (e) => {
      if (e.sourceDataType === "content" && !this.updating) {
        this.debouncedScan();
      }
    });

    // Re-apply filter after a FULL style rebuild (ChartManager resets layers
    // to placeholder). Guard with `updating` to break styledata feedback loop
    // from our own setFilter/setPaintProperty calls.
    map.on("styledata", () => {
      if (!this.updating) {
        this.reapplyAll();
      }
    });

    // When safetyDepth changes, resolve from cache (instant) + targeted updates
    // Throttle MapLibre updates — apply immediately on first change,
    // then no more than once per THROTTLE_MS while dragging.
    onSettingsChange((s) => {
      if (s.safetyDepth !== this.prevSafetyDepth) {
        this.prevSafetyDepth = s.safetyDepth;
        this.pendingSafetyDepth = s.safetyDepth;
        if (!this.throttleTimer) {
          // Fire immediately on first change
          this.flushPending();
          // Then suppress further applies for THROTTLE_MS
          this.throttleTimer = setTimeout(() => {
            this.throttleTimer = null;
            // Apply the latest value if it changed during the throttle window
            if (this.pendingSafetyDepth !== null) {
              this.flushPending();
            }
          }, SafetyContour.THROTTLE_MS);
        }
      }
    });

    // Initial scan once map is loaded
    map.on("load", () => {
      this.scanTiles();
    });
  }

  /** Apply the pending safetyDepth update to MapLibre. */
  private flushPending(): void {
    const depth = this.pendingSafetyDepth;
    if (depth === null) return;
    this.pendingSafetyDepth = null;
    this.resolveFromCache(depth);
    this.updating = true;
    this.applyAll(depth);
    this.updating = false;
  }

  /** Debounced tile scan — only re-queries features at most once per 1s. */
  private debouncedScan(): void {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => {
      this.scanTiles();
    }, 1000);
  }

  /** Scan all loaded DEPCNT features and cache VALDCO values grouped by _cell_id. */
  private scanTiles(): void {
    const byCell = new Map<number, Set<number>>();

    for (const srcId of getVectorSourceIds()) {
      try {
        const features = this.map.querySourceFeatures(srcId, {
          sourceLayer: "DEPCNT",
        });
        for (const f of features) {
          const cellId = (f.properties?._cell_id as number) ?? 0;
          const v = f.properties?.VALDCO;
          if (typeof v === "number" && v > 0) {
            if (!byCell.has(cellId)) byCell.set(cellId, new Set());
            byCell.get(cellId)?.add(v);
          }
        }
      } catch {
        // Source may not be loaded yet
      }
    }

    // Store as sorted arrays per cell
    this.valdcoByCell = new Map(
      [...byCell].map(([cellId, vals]) => [
        cellId,
        [...vals].sort((a, b) => a - b),
      ]),
    );

    this.resolveFromCache(getSettings().safetyDepth);
  }

  /** Resolve the safety contour per cell from cached VALDCO values. */
  private resolveFromCache(safetyDepth: number): void {
    const resolved = new Map<number, number>();
    for (const [cellId, vals] of this.valdcoByCell) {
      const v = vals.find((val) => val >= safetyDepth);
      if (v !== undefined) resolved.set(cellId, v);
    }

    // Check if anything changed
    if (mapsEqual(this.resolvedByCell, resolved)) return;
    this.resolvedByCell = resolved;
    this.applyContourFilter();
  }

  private updateDepareColors(safetyDepth: number): void {
    const colorExpr = [
      "case",
      ["<", ["get", "DRVAL1"], safetyDepth],
      s52Colour("DEPMS"),
      s52Colour("DEPMD"),
    ];
    forEachLayer(this.map, getRegionLayerIds("depare-medium"), (id) =>
      this.map.setPaintProperty(id, "fill-color", colorExpr),
    );
  }

  private updateSoundingColors(safetyDepth: number): void {
    const colorExpr = [
      "case",
      ["<=", ["get", "DEPTH"], safetyDepth],
      s52Colour("SNDG2"),
      s52Colour("SNDG1"),
    ];
    forEachLayer(this.map, getRegionLayerIds("soundg"), (id) =>
      this.map.setPaintProperty(id, "text-color", colorExpr),
    );
  }

  private updateIsolatedDangerFilters(safetyDepth: number): void {
    const filter = [
      "all",
      ["has", "_enclosing_depth"],
      ["has", "VALSOU"],
      ["<=", ["get", "VALSOU"], safetyDepth],
      [">=", ["get", "_enclosing_depth"], safetyDepth],
    ] as unknown as FilterSpecification;
    const layerIds = ISOLATED_DANGER_SUFFIXES.flatMap(getRegionLayerIds);
    forEachLayer(this.map, layerIds, (id) => this.map.setFilter(id, filter));
  }

  private applyAll(safetyDepth: number): void {
    this.applyContourFilter();
    this.updateSoundingColors(safetyDepth);
    this.updateDepareColors(safetyDepth);
    this.updateIsolatedDangerFilters(safetyDepth);
  }

  /** Re-apply after a full style rebuild resets layers to placeholder. */
  private reapplyAll(): void {
    if (this.resolvedByCell.size > 0) {
      this.updating = true;
      this.applyAll(getSettings().safetyDepth);
      this.updating = false;
    }
  }

  private applyContourFilter(): void {
    const filter = buildPerCellFilter(this.resolvedByCell);
    forEachLayer(this.map, getRegionLayerIds("depcnt-safety"), (id) =>
      this.map.setFilter(id, filter),
    );
  }
}

/**
 * Build a MapLibre filter that matches each DEPCNT feature's VALDCO
 * against the resolved safety contour for its _cell_id.
 *
 * Result: ["==", ["get", "VALDCO"], ["match", ["get", "_cell_id"], id1, val1, id2, val2, ..., -1]]
 */
function buildPerCellFilter(
  resolvedByCell: Map<number, number>,
): FilterSpecification {
  if (resolvedByCell.size === 0) {
    return ["==", ["get", "VALDCO"], -1] as FilterSpecification;
  }

  const matchArgs: (string | number | unknown[])[] = [["get", "_cell_id"]];
  for (const [cellId, valdco] of resolvedByCell) {
    matchArgs.push(cellId, valdco);
  }
  matchArgs.push(-1); // default — impossible match

  return [
    "==",
    ["get", "VALDCO"],
    ["match", ...matchArgs],
  ] as unknown as FilterSpecification;
}

/** Compare two Map<number, number> for equality. */
function mapsEqual(a: Map<number, number>, b: Map<number, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}
