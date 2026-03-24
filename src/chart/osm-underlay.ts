/**
 * OSM underlay: merge OSM raster tiles underneath S-57 vector chart layers.
 * Water areas (DEPARE) are fully opaque, so OSM only shows through on land.
 */
import type {
  BackgroundLayerSpecification,
  FillLayerSpecification,
  LayerSpecification,
} from "maplibre-gl";
import type { DisplayTheme } from "../settings";

const OSM_SOURCE_ID = "osm-underlay";

/** OSM raster source specification for the underlay. */
export function getOSMUnderlaySource(): {
  id: string;
  source: {
    type: "raster";
    tiles: string[];
    tileSize: number;
    attribution: string;
  };
} {
  return {
    id: OSM_SOURCE_ID,
    source: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  };
}

/** Brightness cap for OSM tiles per theme (darker themes = dimmer OSM). */
function osmBrightness(theme: DisplayTheme): number {
  switch (theme) {
    case "night":
      return 0.3;
    case "dusk":
      return 0.5;
    case "eink":
      return 0.9;
    default:
      return 1.0;
  }
}

/**
 * Water-area fill layer suffixes that must become opaque when OSM underlay
 * is active, to prevent OSM from bleeding through on water.
 * Matches any region prefix: s57-{regionId}-drgare, etc.
 */
const WATER_FILL_SUFFIXES = ["-drgare", "-lakare", "-rivers"];

/**
 * Merge OSM underlay into S-57 layers.
 * - Inserts an OSM raster layer at position 0 (below everything)
 * - Makes the background layer transparent (DEPARE + water fills cover water)
 * - Makes water-area fills fully opaque to hide OSM on water
 * - Reduces land area opacity so OSM shows through
 *
 * Uses suffix matching so this works with multi-region prefixed layer IDs
 * (e.g. s57-northern-new-england-lndare, s57-usvi-lndare).
 */
export function applyOSMUnderlay(
  s57Layers: LayerSpecification[],
  landOpacity: number,
  theme: DisplayTheme,
): LayerSpecification[] {
  const osmLayer: LayerSpecification = {
    id: "osm-underlay-layer",
    type: "raster",
    source: OSM_SOURCE_ID,
    paint: {
      "raster-brightness-max": osmBrightness(theme),
    },
  };

  const adjusted = s57Layers.map((layer): LayerSpecification => {
    if (layer.type === "background") {
      const bg = layer as BackgroundLayerSpecification;
      return { ...bg, paint: { ...bg.paint, "background-opacity": 0 } };
    }
    if (layer.type === "fill" && layer.id.endsWith("-lndare")) {
      const fill = layer as FillLayerSpecification;
      return { ...fill, paint: { ...fill.paint, "fill-opacity": landOpacity } };
    }
    if (layer.type === "fill" && layer.id.endsWith("-buisgl")) {
      const fill = layer as FillLayerSpecification;
      return {
        ...fill,
        paint: {
          ...fill.paint,
          "fill-opacity": Math.min(landOpacity + 0.1, 0.8),
        },
      };
    }
    // Make water-area fills opaque to hide OSM on water
    if (
      layer.type === "fill" &&
      WATER_FILL_SUFFIXES.some((s) => layer.id.endsWith(s))
    ) {
      const fill = layer as FillLayerSpecification;
      return { ...fill, paint: { ...fill.paint, "fill-opacity": 1 } };
    }
    return layer;
  });

  return [osmLayer, ...adjusted];
}
