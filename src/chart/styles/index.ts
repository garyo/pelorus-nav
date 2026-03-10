/**
 * Public API for the nautical chart style system.
 *
 * Re-exports getNauticalLayers() with the same signature as the
 * original monolithic nautical-style.ts, but composed from
 * category-specific layer modules.
 */
import type { LayerSpecification } from "maplibre-gl";
import type { DepthUnit, DisplayTheme, SymbologyScheme } from "../../settings";
import {
  getAdditionalAreaLayers,
  getAreaLayers,
  getCoverageLayers,
} from "./layers/areas";
import {
  getAdditionalLineLayers,
  getLineLayers,
  getOtherLineLayers,
} from "./layers/lines";
import {
  getNavigationOverlayLayers,
  getNavigationRoutingLayers,
} from "./layers/navigation";
import {
  getAdditionalPointLayers,
  getDaymarkTopmarkLayers,
  getHazardLayers,
  getNavAidLayers,
  getOtherNavAidLayers,
  getOtherPointLayers,
} from "./layers/points";
import { getTextLayers } from "./layers/text";
import { createStyleContext } from "./style-context";

/** Maps layer IDs to group names for per-group toggle control. */
const LAYER_GROUPS: Record<string, string> = {
  "s57-navlne": "routing",
  "s57-rectrc": "routing",
  "s57-dwrtcl": "routing",
  "s57-tssbnd": "routing",
  "s57-tsslpt": "routing",
  "s57-tsezne": "routing",
  "s57-tsezne-outline": "routing",
  "s57-twrtpt": "routing",
  "s57-twrtpt-outline": "routing",
  "s57-resare": "restrictedAreas",
  "s57-ctnare": "restrictedAreas",
  "s57-achare": "anchorage",
  "s57-achbrt": "anchorage",
  "s57-cblare": "cablesAndPipes",
  "s57-cblsub": "cablesAndPipes",
  "s57-cblohd": "cablesAndPipes",
  "s57-pipare": "cablesAndPipes",
  "s57-pipsol": "cablesAndPipes",
  "s57-siltnk": "facilities",
  "s57-siltnk-outline": "facilities",
  "s57-siltnk-icon": "facilities",
  "s57-hrbfac": "facilities",
  "s57-smcfac-label": "facilities",
  "s57-ofsplf": "facilities",
  "s57-dmpgrd": "facilities",
  "s57-dmpgrd-outline": "facilities",
  "s57-magvar": "magneticVariation",
  "s57-sbdare": "seabed",
  "s57-daymar": "daymarksTopmarks",
  "s57-topmar": "daymarksTopmarks",
  "s57-prcare": "restrictedAreas",
  "s57-prcare-outline": "restrictedAreas",
  "s57-pilbop": "routing",
  "s57-fshfac": "routing",
  "s57-cranes": "facilities",
  "s57-cgusta": "facilities",
  "s57-drydoc": "facilities",
  "s57-drydoc-outline": "facilities",
  "s57-airare": "facilities",
  "s57-airare-outline": "facilities",
  "s57-runway": "facilities",
  "s57-runway-outline": "facilities",
};

/** Display category -> layer ID mapping for filtering. */
const LAYER_CATEGORIES: Record<string, "DISPLAYBASE" | "STANDARD" | "OTHER"> = {
  "s57-lndare": "DISPLAYBASE",
  "s57-lndare-point": "DISPLAYBASE",
  "s57-depare-shallow": "DISPLAYBASE",
  "s57-depare-medium": "DISPLAYBASE",
  "s57-depare-deep": "DISPLAYBASE",
  "s57-depare-drying": "DISPLAYBASE",
  "s57-unsare": "DISPLAYBASE",
  "s57-coalne": "DISPLAYBASE",
  "s57-depcnt": "DISPLAYBASE",
  "s57-soundg": "DISPLAYBASE",
  "s57-wrecks": "DISPLAYBASE",
  "s57-obstrn": "DISPLAYBASE",
  "s57-obstrn-area": "DISPLAYBASE",
  "s57-obstrn-line": "DISPLAYBASE",
  "s57-uwtroc": "DISPLAYBASE",
  "s57-background": "DISPLAYBASE",
  // STANDARD
  "s57-lakare": "STANDARD",
  "s57-rivers": "STANDARD",
  "s57-drgare": "STANDARD",
  "s57-drgare-outline": "STANDARD",
  "s57-slcons": "STANDARD",
  "s57-bridge": "STANDARD",
  "s57-cblsub": "STANDARD",
  "s57-cblohd": "STANDARD",
  "s57-fairwy": "STANDARD",
  "s57-fairwy-outline": "STANDARD",
  "s57-achare": "STANDARD",
  "s57-tsslpt": "STANDARD",
  "s57-resare": "STANDARD",
  "s57-ctnare": "STANDARD",
  "s57-boylat": "STANDARD",
  "s57-boycar": "STANDARD",
  "s57-boysaw": "STANDARD",
  "s57-boyspp": "STANDARD",
  "s57-boyisd": "STANDARD",
  "s57-bcnlat": "STANDARD",
  "s57-bcncar": "STANDARD",
  "s57-lights": "STANDARD",
  "s57-lights-glow": "STANDARD",
  "s57-fogsig": "STANDARD",
  "s57-lndmrk": "STANDARD",
  "s57-lndare-label": "STANDARD",
  "s57-seaare-label": "STANDARD",
  "s57-navlne": "STANDARD",
  "s57-rectrc": "STANDARD",
  "s57-dwrtcl": "STANDARD",
  "s57-tssbnd": "STANDARD",
  "s57-tsezne": "STANDARD",
  "s57-tsezne-outline": "STANDARD",
  "s57-twrtpt": "STANDARD",
  "s57-twrtpt-outline": "STANDARD",
  "s57-achbrt": "STANDARD",
  "s57-bcnspp": "STANDARD",
  // OTHER
  "s57-buisgl": "STANDARD",
  "s57-buisgl-outline": "STANDARD",
  "s57-ponton": "OTHER",
  "s57-berths-label": "OTHER",
  "s57-pilpnt": "OTHER",
  "s57-morfac": "OTHER",
  "s57-sbdare": "OTHER",
  "s57-cblare": "OTHER",
  "s57-pipare": "OTHER",
  "s57-pipsol": "OTHER",
  "s57-dmpgrd": "OTHER",
  "s57-dmpgrd-outline": "OTHER",
  "s57-siltnk": "OTHER",
  "s57-siltnk-outline": "OTHER",
  "s57-siltnk-icon": "OTHER",
  "s57-hrbfac": "OTHER",
  "s57-smcfac-label": "OTHER",
  "s57-slcons-label": "OTHER",
  "s57-buisgl-label": "OTHER",
  "s57-ofsplf": "OTHER",
  "s57-magvar": "OTHER",
  "s57-daymar": "OTHER",
  "s57-topmar": "OTHER",
  // New STANDARD layers
  "s57-prcare": "STANDARD",
  "s57-prcare-outline": "STANDARD",
  "s57-pilbop": "STANDARD",
  "s57-wattur": "STANDARD",
  "s57-gatcon": "STANDARD",
  "s57-damcon": "STANDARD",
  "s57-tunnel": "STANDARD",
  "s57-fshfac": "STANDARD",
  "s57-dykcon": "STANDARD",
  "s57-slotop": "STANDARD",
  "s57-pylons": "STANDARD",
  "s57-hulkes": "STANDARD",
  // New OTHER layers
  "s57-cranes": "OTHER",
  "s57-forstc": "OTHER",
  "s57-cgusta": "OTHER",
  "s57-drydoc": "OTHER",
  "s57-drydoc-outline": "OTHER",
  "s57-runway": "OTHER",
  "s57-runway-outline": "OTHER",
  "s57-airare": "OTHER",
  "s57-airare-outline": "OTHER",
};

/** Per-layer minzoom at which OTHER layers appear at Standard detail. */
const OTHER_STANDARD_MINZOOM: Record<string, number> = {
  "s57-siltnk": 14,
  "s57-siltnk-outline": 14,
  "s57-siltnk-icon": 14,
  "s57-hrbfac": 14,
  "s57-ofsplf": 14,
  "s57-buisgl": 14,
};

/** Category visibility filter helper. */
function catFilter(
  category: "DISPLAYBASE" | "STANDARD" | "OTHER",
  showStandard: boolean,
  showOther: boolean,
): boolean {
  if (category === "DISPLAYBASE") return true;
  if (category === "STANDARD") return showStandard;
  return showOther || showStandard; // build OTHER layers; filter later
}

export function getNauticalLayers(
  sourceId: string,
  depthUnit: DepthUnit = "meters",
  detailOffset = 0,
  layerGroups: Record<string, boolean> = {},
  coverageSourceId?: string,
  theme: DisplayTheme = "day",
  symbology: SymbologyScheme = "pelorus-standard",
  shallowDepth = 5,
  deepDepth = 20,
): LayerSpecification[] {
  const ctx = createStyleContext(
    sourceId,
    depthUnit,
    detailOffset,
    layerGroups,
    theme,
    coverageSourceId,
    symbology,
    shallowDepth,
    deepDepth,
  );

  // Build layer array in the exact same order as the original monolithic
  // function. Layer draw order is critical for correct rendering.
  //
  // Original order:
  //   1. Background + area fills (DEPARE, LNDARE, COALNE, LAKARE, RIVERS,
  //      DRGARE, PONTON, BUISGL, UNSARE)
  //   2. Regulatory overlay fills/outlines (FAIRWY, ACHARE, TSSLPT, RESARE, CTNARE)
  //   3. Routing lines [STANDARD] (NAVLNE, RECTRC, DWRTCL, TSSBND, TSEZNE, TWRTPT, ACHBRT)
  //   4. Line layers (DEPCNT, SLCONS, BRIDGE, CBLSUB, CBLOHD)
  //   5. Nav aid symbols (SOUNDG, LIGHTS, buoys, beacons lat/car)
  //   6. Labels + landmarks (LNDARE-label, LNDMRK, berths, SEAARE-label)
  //   7. Hazards (WRECKS, OBSTRN, UWTROC)
  //   8. Other nav aids (FOGSIG, PILPNT, MORFAC, BCNSPP, SBDARE)
  //   9. OTHER category [conditional] (CBLARE, PIPARE, PIPSOL, DMPGRD,
  //      SILTNK, HRBFAC, OFSPLF, MAGVAR)
  //  10. Daymarks/topmarks [OTHER]
  //  11. Coverage mask

  const layers: LayerSpecification[] = [
    // 1. Area fills (background, depth areas, land, coastline, lakes, etc.)
    ...getAreaLayers(ctx),

    // 2. Regulatory overlay fills and outlines
    ...getNavigationOverlayLayers(ctx),

    // 3. Routing / regulatory lines (STANDARD category, conditionally built)
    ...(catFilter("STANDARD", ctx.showStandard, ctx.showOther)
      ? getNavigationRoutingLayers(ctx)
      : []),

    // 4. Line layers (depth contours, shoreline constructions, bridges, cables)
    ...getLineLayers(ctx),

    // 4b. Additional line layers (dykes, slopes, gates, dams)
    ...getAdditionalLineLayers(ctx),

    // 5. Nav aid symbols (soundings, lights, buoys, beacons)
    ...getNavAidLayers(ctx),

    // 6. Labels + landmarks
    ...getTextLayers(ctx),

    // 7. Hazards (wrecks, obstructions, underwater rocks)
    ...getHazardLayers(ctx),

    // 8. Other nav aids (fog signals, pilings, mooring, special beacons, seabed)
    ...getOtherNavAidLayers(ctx),

    // 8b. Additional point layers (pilot boarding, water turbulence, etc.)
    ...getAdditionalPointLayers(ctx),

    // 9. OTHER category: cables, pipes, facilities, platforms, magvar
    ...(catFilter("OTHER", ctx.showStandard, ctx.showOther)
      ? [
          ...getOtherLineLayers(ctx),
          ...getOtherPointLayers(ctx),
          ...getAdditionalAreaLayers(ctx),
        ]
      : []),

    // 10. Daymarks and topmarks (OTHER category)
    ...(catFilter("OTHER", ctx.showStandard, ctx.showOther)
      ? getDaymarkTopmarkLayers(ctx)
      : []),

    // 11. Coverage mask (on top of all chart layers)
    ...getCoverageLayers(ctx),
  ];

  // Apply display category and layer group filtering
  return layers.filter((layer) => {
    const cat = LAYER_CATEGORIES[layer.id];
    const group = LAYER_GROUPS[layer.id];
    if (group !== undefined && layerGroups[group] === false) return false;

    // OTHER layers at Standard detail: include only if they have a
    // high-zoom override, and raise their minzoom accordingly.
    if (cat === "OTHER" && !ctx.showOther) {
      const overrideZoom = OTHER_STANDARD_MINZOOM[layer.id];
      if (overrideZoom === undefined) return false;
      const existing = (layer as { minzoom?: number }).minzoom ?? 0;
      (layer as { minzoom?: number }).minzoom = Math.max(
        existing,
        overrideZoom,
      );
      return true;
    }

    if (cat !== undefined) {
      if (cat === "DISPLAYBASE") return true;
      if (cat === "STANDARD") return ctx.showStandard;
      return ctx.showOther;
    }
    return true;
  });
}
