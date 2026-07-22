/**
 * Offline vector street basemap underlay (Protomaps/OpenStreetMap extract).
 *
 * Each region can have a basemap-<region>.pmtiles built by
 * tools/basemap/build-basemap.py: z0-13 over a 10 nm coastal band plus
 * z14-15 street detail around US5/US6 harbor cells. When the active region's
 * basemap is downloaded to OPFS, it replaces the network-only OSM raster
 * underlay; areas without basemap tiles (deep inland, or beyond the harbor
 * band at high zoom) fall back to the normal chart via applyUnderlay's
 * fallback copies.
 */
import { namedFlavor, layers as protomapsLayers } from "@protomaps/basemaps";
import type {
  FilterSpecification,
  LayerSpecification,
  SourceSpecification,
} from "maplibre-gl";
import { PMTiles } from "pmtiles";
import { OPFSSource } from "../data/opfs-source";
import { chartAssetBase } from "../data/remote-url";
import { getChartFile } from "../data/tile-store";
import type { DisplayTheme } from "../settings";
import { enumerateCellsByZoom, lonLatToCell } from "./chart-footprint";

export const BASEMAP_SOURCE_ID = "basemap-underlay";
/**
 * Second view of the same tiles, capped at z14 so street-name layers lay
 * out against overscaled tiles one level early. MapLibre decides line-label
 * fit per tile pyramid level (in tile units), so labels that need z16-scale
 * geometry to fit appear a full zoom earlier when their source overscales
 * from z14. Scoped to z13-14 so the duplicate tile parsing stays small.
 */
export const BASEMAP_LABEL_SOURCE_ID = "basemap-underlay-labels";

/** Basemap PMTiles filename for a region. */
export function basemapFilename(regionId: string): string {
  return `basemap-${regionId}.pmtiles`;
}

/** Region ids whose basemap is downloaded to OPFS. Set from main.ts. */
let storedBasemaps = new Set<string>();

export function setStoredBasemaps(regionIds: Set<string>): void {
  storedBasemaps = regionIds;
}

export function hasStoredBasemap(regionId: string): boolean {
  return storedBasemaps.has(regionId);
}

/** Extract region ids from stored chart filenames (basemap-<region>.pmtiles). */
export function basemapRegionsFromFilenames(filenames: string[]): Set<string> {
  const ids = new Set<string>();
  for (const f of filenames) {
    const m = f.match(/^basemap-(.+)\.pmtiles$/);
    if (m) ids.add(m[1]);
  }
  return ids;
}

/**
 * What the stored basemap actually covers (a coastal band + harbor pockets,
 * NOT its region's bbox), as the archive's own tile-cell set at one zoom.
 * Read from the PMTiles directory — no geographic assumptions — so it stays
 * correct for any future region, producer, or non-US basemap.
 */
export interface BasemapCoverage {
  zoom: number;
  cells: Set<string>;
  /** [w, s, e, n] hull of the cells — the O(1) quick-reject gate. */
  bbox: [number, number, number, number];
}

/** Coverage cells are kept at this zoom (~2 nm cells; band is ~10 nm). */
const COVERAGE_ZOOM = 10;

let coverage: BasemapCoverage | null = null;
let coverageToken = 0;

export function getBasemapCoverage(): BasemapCoverage | null {
  return coverage;
}

/**
 * Load the active region's stored basemap coverage from its OPFS archive
 * (~tens of ms for a 250 MB basemap; directory reads only, no tile data).
 * Clears to null — "unknown, assume uncovered" — when there is no stored
 * basemap or the archive can't be enumerated.
 */
export async function loadBasemapCoverage(regionId: string): Promise<void> {
  const token = ++coverageToken;
  coverage = null;
  const file = await getChartFile(basemapFilename(regionId));
  if (!file) return;
  try {
    const archive = new PMTiles(new OPFSSource(file, file.name));
    const byZoom = await enumerateCellsByZoom(archive);
    if (token !== coverageToken || !byZoom) return; // superseded / too big
    // Deepest zoom at or below COVERAGE_ZOOM present in the archive
    let zoom = -1;
    for (const z of byZoom.keys()) {
      if (z <= COVERAGE_ZOOM && z > zoom) zoom = z;
    }
    const cells = zoom >= 0 ? (byZoom.get(zoom) as Set<string>) : null;
    if (!cells || cells.size === 0) return;
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (const cell of cells) {
      const [x, y] = cell.split(",").map(Number);
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    const n = 2 ** zoom;
    const lon = (x: number) => (x / n) * 360 - 180;
    const lat = (y: number) =>
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
    coverage = {
      zoom,
      cells,
      bbox: [lon(x0), lat(y1 + 1), lon(x1 + 1), lat(y0)],
    };
  } catch {
    // unreadable archive — leave coverage null (uncapped OSM, correct display)
  }
}

/**
 * True when the basemap has tiles for the ENTIRE viewport — the only case
 * where streaming OSM underneath adds nothing. Ordered cheapest-first:
 * two O(1) rejects (bbox hull, candidate count) before any set lookups;
 * the loop then runs only for small in-band viewports (≲ a few dozen cells).
 */
export function isViewportCovered(
  cov: BasemapCoverage | null,
  viewport: [number, number, number, number] | null,
): boolean {
  if (!cov || !viewport) return false;
  const [w, s, e, n] = viewport;
  // Quick reject: viewport not fully inside the coverage hull
  if (w < cov.bbox[0] || s < cov.bbox[1] || e > cov.bbox[2] || n > cov.bbox[3])
    return false;
  const [x0, y0] = lonLatToCell(w, n, cov.zoom); // NW corner
  const [x1, y1] = lonLatToCell(e, s, cov.zoom); // SE corner
  // Quick reject: more candidate cells than the whole coverage set
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > cov.cells.size) return false;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (!cov.cells.has(`${x},${y}`)) return false;
    }
  }
  return true;
}

export function getBasemapSources(
  regionId: string,
): Record<string, SourceSpecification> {
  const url = `${chartAssetBase()}/${basemapFilename(regionId)}`;
  const tiles = [`pmtiles://${url}/{z}/{x}/{y}`];
  const attribution =
    '<a href="https://protomaps.com">Protomaps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  return {
    [BASEMAP_SOURCE_ID]: {
      type: "vector",
      tiles,
      minzoom: 0,
      maxzoom: 15,
      attribution,
    },
    [BASEMAP_LABEL_SOURCE_ID]: {
      type: "vector",
      tiles,
      minzoom: 13,
      maxzoom: 14,
    },
  };
}

/**
 * Basemap label layers that should ride above the chart's fills (see
 * applyUnderlay's underlayLabels): town names and street names straddling
 * the shoreline must not be chopped by the opaque water fills. Water-body
 * names stay low — the chart's own SEAARE labels cover charted water, and
 * beyond chart coverage nothing occludes them anyway.
 */
export function isLiftedBasemapLabel(layer: LayerSpecification): boolean {
  return layer.type === "symbol" && !layer.id.startsWith("basemap-water_");
}

/** Protomaps flavor per display theme. The e-ink panel is color (Kaleido). */
function flavorName(theme: DisplayTheme): string {
  switch (theme) {
    case "night":
      return "black";
    case "dusk":
      return "dark";
    default:
      return "light";
  }
}

/**
 * Stock Protomaps gates some labels later than raster OSM shows them; pull
 * them earlier so street names appear at approach/docking zooms.
 */
const MINZOOM_OVERRIDES: Record<string, number> = {
  roads_labels_minor: 13,
};

/**
 * Themed, trimmed Protomaps layer set for the underlay:
 * - no background layer (empty tiles must fall through to the chart fallback)
 * - no icon symbols (POIs, highway shields — sprites aren't bundled)
 * - text-font remapped to the bundled Noto Sans glyph stacks
 * - denser labels than stock to match raster OSM: minor street names from
 *   z13 in a smaller, tighter-spaced font; POI names (marinas, landmarks)
 *   one zoom earlier; street names placed before POIs so they win collisions
 */
export function getBasemapLayers(theme: DisplayTheme): LayerSpecification[] {
  const flavor = namedFlavor(flavorName(theme));
  const result: LayerSpecification[] = [];
  for (const layer of protomapsLayers(BASEMAP_SOURCE_ID, flavor, {
    lang: "en",
  })) {
    if (layer.type === "background") continue;
    const minzoom = MINZOOM_OVERRIDES[layer.id];
    if (minzoom !== undefined) layer.minzoom = minzoom;
    if (layer.type === "symbol") {
      const layout = { ...layer.layout };
      if (layout["icon-image"]) {
        if (!layout["text-field"]) continue; // icon-only (POIs, shields)
        delete layout["icon-image"];
      }
      if (layout["text-font"]) {
        layout["text-font"] = remapFonts(layout["text-font"] as string[]);
      }
      let filter = layer.filter;
      let source = layer.source;
      if (layer.id === "roads_labels_minor") {
        // Smaller, denser street names — short downtown blocks can't fit
        // the stock 12px labels until far too deep a zoom — laid out
        // against the overscaled label source so fit succeeds a zoom early.
        // Grows visibly past z16 for cockpit glanceability when docking.
        layout["text-size"] = [
          "interpolate",
          ["linear"],
          ["zoom"],
          13,
          9,
          16,
          12,
          18,
          16,
        ];
        layout["symbol-spacing"] = 150;
        source = BASEMAP_LABEL_SOURCE_ID;
      }
      if (layer.id === "roads_labels_major") {
        // Grows in step with the minors, staying a notch bigger
        layout["text-size"] = [
          "interpolate",
          ["linear"],
          ["zoom"],
          15,
          12,
          18,
          16,
        ];
      }
      if (layer.id === "pois") {
        filter = offsetFeatureMinZoom(filter, -1);
      }
      result.push({
        ...layer,
        id: `basemap-${layer.id}`,
        source,
        layout,
        ...(filter !== undefined && { filter }),
      });
      continue;
    }
    result.push({ ...layer, id: `basemap-${layer.id}` });
  }
  // Symbol placement priority is topmost-first: keep POIs below the street
  // label layers so street names win collisions in dense areas.
  const poiIdx = result.findIndex((l) => l.id === "basemap-pois");
  const minorIdx = result.findIndex(
    (l) => l.id === "basemap-roads_labels_minor",
  );
  if (minorIdx >= 0 && poiIdx > minorIdx) {
    const [poi] = result.splice(poiIdx, 1);
    result.splice(minorIdx, 0, poi);
  }
  return result;
}

/**
 * Protomaps gates POI visibility per-feature via a
 * `[">=", ["zoom"], ["+", ["get", "min_zoom"], 0]]` filter clause.
 * Rewrite the offset so features appear `offset` zoom levels earlier —
 * the same idea as the chart pipeline's zoom-shift.
 */
function offsetFeatureMinZoom(
  filter: unknown,
  offset: number,
): FilterSpecification {
  const walk = (node: unknown): unknown => {
    if (!Array.isArray(node)) return node;
    if (
      node[0] === ">=" &&
      JSON.stringify(node[1]) === '["zoom"]' &&
      Array.isArray(node[2]) &&
      node[2][0] === "+"
    ) {
      return [">=", ["zoom"], ["+", node[2][1], offset]];
    }
    return node.map(walk);
  };
  return walk(filter) as FilterSpecification;
}

/**
 * Only Noto Sans Regular/Bold/Italic glyphs are bundled (see CLAUDE.md);
 * any other stack would render blank labels.
 */
function remapFonts(fonts: string[]): string[] {
  const name = fonts[0] ?? "";
  if (name.includes("Italic")) return ["Noto Sans Italic"];
  if (name.includes("Medium") || name.includes("Bold"))
    return ["Noto Sans Bold"];
  return ["Noto Sans Regular"];
}
