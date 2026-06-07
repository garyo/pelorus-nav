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
import type { LayerSpecification, SourceSpecification } from "maplibre-gl";
import { chartAssetBase } from "../data/remote-url";
import type { DisplayTheme } from "../settings";

export const BASEMAP_SOURCE_ID = "basemap-underlay";

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

export function getBasemapSource(regionId: string): SourceSpecification {
  const url = `${chartAssetBase()}/${basemapFilename(regionId)}`;
  return {
    type: "vector",
    tiles: [`pmtiles://${url}/{z}/{x}/{y}`],
    minzoom: 0,
    maxzoom: 15,
    attribution:
      '<a href="https://protomaps.com">Protomaps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  };
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
 * - minor street names shown from z13 (the stock style waits until z15)
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
      result.push({
        ...layer,
        id: `basemap-${layer.id}`,
        layout,
      });
      continue;
    }
    result.push({ ...layer, id: `basemap-${layer.id}` });
  }
  return result;
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
