/**
 * Point/symbol layer definitions: soundings, buoys, beacons, lights,
 * landmarks, wrecks, underwater rocks, obstructions, platforms, pilings,
 * fog signals, mooring facilities.
 */
import type {
  ExpressionSpecification,
  LayerSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";
import type { StyleContext } from "../style-context";
import {
  depthTextField,
  LABEL_EXPR,
  lightLabelTextField,
  SORT_KEY_FACILITY,
  SORT_KEY_HAZARD,
  SORT_KEY_LIGHT_CHAR,
  SORT_KEY_NAVAID,
  scaledTextSize,
  scaleSize,
  VARIABLE_ANCHOR_LAYOUT,
  valsouTextField,
} from "../style-context";

/**
 * Scale an icon-size value by the context's iconSizeScale.
 */
function scaledSize(
  base: number | ExpressionSpecification,
  ctx: StyleContext,
): number | ExpressionSpecification {
  return scaleSize(base, ctx.iconSizeScale);
}

/**
 * Add icon-offset to a symbol layer layout if an offset expression is provided.
 */
function withOffset(
  layout: SymbolLayerSpecification["layout"],
  offsetExpr: ExpressionSpecification | null,
): SymbolLayerSpecification["layout"] {
  if (!offsetExpr) return layout;
  return { ...layout, "icon-offset": offsetExpr };
}

/** Soundings and light indicators (lower-priority nav aid symbols). */
export function getNavAidLayers(ctx: StyleContext): LayerSpecification[] {
  return [
    // Soundings
    {
      id: "s57-soundg",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "SOUNDG",
      layout: {
        "text-field": depthTextField(ctx.depthUnit),
        "text-size": scaledTextSize(10, ctx),
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": [
          "case",
          ["<=", ["get", "DEPTH"], ctx.safetyDepth],
          ctx.colour("SNDG2"), // high-contrast — at or below safety depth
          ctx.colour("SNDG1"), // gray — deeper than safety depth
        ] as unknown as string,
        "text-halo-color": ctx.colour("SNDGH"),
        "text-halo-width": 1,
      },
    },

    // Lights glow — underneath buoys and light icons
    {
      id: "s57-lights-glow",
      type: "circle",
      source: ctx.sourceId,
      "source-layer": "LIGHTS",
      minzoom: 6,
      paint: {
        "circle-radius": 12,
        "circle-color": ctx.colour("LITYW"),
        "circle-blur": 0.6,
        "circle-stroke-width": 2,
        "circle-stroke-color": ctx.colour("LITYW"),
        "circle-opacity": 0.25,
        "circle-stroke-opacity": 0.5,
      },
    },
  ];
}

/**
 * Lights, buoys, and beacons — placed late in the style for high
 * collision priority (MapLibre places symbols in reverse style order,
 * so later layers get placed first and win collisions).
 * Buoys/beacons come after lights so their labels win over light
 * characteristics when they share the same object.
 */
export function getBuoyBeaconLayers(ctx: StyleContext): LayerSpecification[] {
  const boylat = ctx.layerExprs("BOYLAT");
  const boycar = ctx.layerExprs("BOYCAR");
  const boysaw = ctx.layerExprs("BOYSAW");
  const boyspp = ctx.layerExprs("BOYSPP");
  const boyisd = ctx.layerExprs("BOYISD");
  const bcnlat = ctx.layerExprs("BCNLAT");
  const bcncar = ctx.layerExprs("BCNCAR");
  const bcnisd = ctx.layerExprs("BCNISD");
  const bcnsaw = ctx.layerExprs("BCNSAW");
  const lights = ctx.layerExprs("LIGHTS");

  return [
    // Lateral buoys
    {
      id: "s57-boylat",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BOYLAT",
      minzoom: 8,
      layout: withOffset(
        {
          "symbol-sort-key": SORT_KEY_NAVAID,
          "icon-image": boylat.iconExpr,
          "icon-size": scaledSize(0.75, ctx),
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": LABEL_EXPR,
          "text-size": scaledTextSize(11, ctx),
          "text-offset": [0, 1.5],
          "text-allow-overlap": false,
          "text-optional": true,
        },
        boylat.offsetExpr,
      ),
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1.5,
      },
    },

    // Cardinal buoys
    {
      id: "s57-boycar",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BOYCAR",
      minzoom: 8,
      layout: withOffset(
        {
          "symbol-sort-key": SORT_KEY_NAVAID,
          "icon-image": boycar.iconExpr,
          "icon-size": scaledSize(0.75, ctx),
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": LABEL_EXPR,
          "text-size": scaledTextSize(11, ctx),
          "text-offset": [0, 1.5],
          "text-allow-overlap": false,
          "text-optional": true,
        },
        boycar.offsetExpr,
      ),
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1.5,
      },
    },

    // Safe water buoys
    {
      id: "s57-boysaw",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BOYSAW",
      minzoom: 8,
      layout: withOffset(
        {
          "symbol-sort-key": SORT_KEY_NAVAID,
          "icon-image": boysaw.iconExpr,
          "icon-size": scaledSize(0.75, ctx),
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": LABEL_EXPR,
          "text-size": scaledTextSize(11, ctx),
          "text-offset": [0, 1.5],
          "text-allow-overlap": false,
          "text-optional": true,
        },
        boysaw.offsetExpr,
      ),
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1.5,
      },
    },

    // Special purpose buoys
    {
      id: "s57-boyspp",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BOYSPP",
      minzoom: 8,
      layout: withOffset(
        {
          "symbol-sort-key": SORT_KEY_NAVAID,
          "icon-image": boyspp.iconExpr,
          "icon-size": scaledSize(0.7, ctx),
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": LABEL_EXPR,
          "text-size": scaledTextSize(11, ctx),
          "text-offset": [0, 1.5],
          "text-allow-overlap": false,
          "text-optional": true,
        },
        boyspp.offsetExpr,
      ),
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1.5,
      },
    },

    // Isolated danger buoys
    {
      id: "s57-boyisd",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BOYISD",
      minzoom: 6,
      layout: withOffset(
        {
          "symbol-sort-key": SORT_KEY_NAVAID,
          "icon-image": boyisd.iconExpr,
          "icon-size": scaledSize(0.75, ctx),
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": LABEL_EXPR,
          "text-size": scaledTextSize(11, ctx),
          "text-offset": [0, 1.5],
          "text-allow-overlap": false,
          "text-optional": true,
        },
        boyisd.offsetExpr,
      ),
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1.5,
      },
    },

    // Lateral beacons
    {
      id: "s57-bcnlat",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BCNLAT",
      minzoom: 8,
      layout: withOffset(
        {
          "symbol-sort-key": SORT_KEY_NAVAID,
          "icon-image": bcnlat.iconExpr,
          "icon-size": scaledSize(0.7, ctx),
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": LABEL_EXPR,
          "text-size": scaledTextSize(11, ctx),
          "text-offset": [0, 1.5],
          "text-allow-overlap": false,
          "text-optional": true,
        },
        bcnlat.offsetExpr,
      ),
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1.5,
      },
    },

    // Cardinal beacons
    {
      id: "s57-bcncar",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BCNCAR",
      minzoom: 8,
      layout: withOffset(
        {
          "symbol-sort-key": SORT_KEY_NAVAID,
          "icon-image": bcncar.iconExpr,
          "icon-size": scaledSize(0.7, ctx),
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": LABEL_EXPR,
          "text-size": scaledTextSize(11, ctx),
          "text-offset": [0, 1.5],
          "text-allow-overlap": false,
          "text-optional": true,
        },
        bcncar.offsetExpr,
      ),
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1.5,
      },
    },

    // Isolated danger beacons
    {
      id: "s57-bcnisd",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BCNISD",
      minzoom: 8,
      layout: withOffset(
        {
          "symbol-sort-key": SORT_KEY_NAVAID,
          "icon-image": bcnisd.iconExpr,
          "icon-size": scaledSize(0.7, ctx),
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": LABEL_EXPR,
          "text-size": scaledTextSize(11, ctx),
          "text-offset": [0, 1.5],
          "text-allow-overlap": false,
          "text-optional": true,
        },
        bcnisd.offsetExpr,
      ),
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1.5,
      },
    },
    // Safe water beacons
    {
      id: "s57-bcnsaw",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BCNSAW",
      minzoom: 8,
      layout: withOffset(
        {
          "symbol-sort-key": SORT_KEY_NAVAID,
          "icon-image": bcnsaw.iconExpr,
          "icon-size": scaledSize(0.7, ctx),
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": LABEL_EXPR,
          "text-size": scaledTextSize(11, ctx),
          "text-offset": [0, 1.5],
          "text-allow-overlap": false,
          "text-optional": true,
        },
        bcnsaw.offsetExpr,
      ),
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1.5,
      },
    },

    // Light icons + characteristics — drawn last so teardrops render
    // on top of buoy/beacon icons. ``LIGHT_CHAR`` sort-key sits below
    // LANDMARK so a lighthouse's name ("Boston Light") wins over its
    // own characteristic label ("Fl(1) 10s 31.1m27M") when they'd
    // otherwise collide. Light text is ``text-optional`` so the flare
    // still shows even when the characteristic is suppressed.
    {
      id: "s57-lights",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "LIGHTS",
      minzoom: 6,
      layout: withOffset(
        {
          "symbol-sort-key": SORT_KEY_LIGHT_CHAR,
          "icon-image": lights.iconExpr,
          "icon-size": scaledSize(0.7, ctx),
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-optional": true,
          "text-field": lightLabelTextField(ctx.depthUnit),
          "text-size": scaledTextSize(10, ctx),
          // Traditional chart convention: light characteristic sits above
          // the teardrop (anchor "bottom" = label extends UP from the
          // point). Fall back to the shoulders, then sides, then below
          // only as a last resort — the teardrop body already occupies
          // "down-right" so placing the label there would overlap it.
          "text-variable-anchor": [
            "bottom",
            "bottom-left",
            "bottom-right",
            "left",
            "right",
            "top-left",
            "top-right",
            "top",
          ],
          // Need a bit more room when the light sits on a topmark — the
          // topmark icon extends above the aid's position.
          "text-radial-offset": [
            "case",
            ["==", ["get", "HAS_TOPMAR"], 1],
            2.4,
            1.0,
          ] as unknown as number,
          "text-justify": "auto",
          "text-allow-overlap": false,
          "text-optional": true,
        },
        lights.offsetExpr,
      ),
      paint: {
        "text-color": ctx.colour("SNDG2"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1.5,
      },
    },
  ];
}

/** Hazard layers: wrecks, obstructions, underwater rocks. */
export function getHazardLayers(ctx: StyleContext): LayerSpecification[] {
  const wrecks = ctx.layerExprs("WRECKS");
  const obstrn = ctx.layerExprs("OBSTRN");
  const uwtroc = ctx.layerExprs("UWTROC");

  return [
    // Wrecks
    {
      id: "s57-wrecks",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "WRECKS",
      minzoom: 10,
      layout: withOffset(
        {
          "icon-image": wrecks.iconExpr,
          "icon-size": scaledSize(
            [
              "interpolate",
              ["linear"],
              ["zoom"],
              10,
              0.45,
              13,
              0.75,
            ] as unknown as ExpressionSpecification,
            ctx,
          ),
          "icon-allow-overlap": [
            "step",
            ["zoom"],
            false,
            13,
            true,
          ] as unknown as ExpressionSpecification,
          // Don't push labels away from wrecks — see UWTROC comment below.
          "icon-ignore-placement": true,
          "icon-padding": 2,
          // Dangerous wrecks (CATWRK=2) get slightly higher priority than
          // non-dangerous within the HAZARD band so they win collisions.
          "symbol-sort-key": [
            "case",
            ["==", ["get", "CATWRK"], 2],
            SORT_KEY_HAZARD,
            SORT_KEY_HAZARD + 1,
          ] as unknown as ExpressionSpecification,
        },
        wrecks.offsetExpr,
      ),
      paint: {},
    },
    // Obstructions — polygon fill (general)
    {
      id: "s57-obstrn-area",
      type: "fill",
      source: ctx.sourceId,
      "source-layer": "OBSTRN",
      minzoom: 11,
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        [
          "!",
          [
            "in",
            ["to-number", ["coalesce", ["get", "CATOBS"], 0], 0],
            ["literal", [6, 7]],
          ],
        ],
      ] as unknown as ExpressionSpecification,
      paint: {
        "fill-color": ctx.colour("DEPVS"),
        "fill-opacity": 0.2,
      },
    },
    // Foul area pattern — OBSTRN.CATOBS=6 (foul area) / 7 (foul ground)
    // S-52: AP(FOULAR01) X-pattern fill + dashed boundary
    {
      id: "s57-obstrn-foul",
      type: "fill",
      source: ctx.sourceId,
      "source-layer": "OBSTRN",
      minzoom: 10,
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        [
          "in",
          ["to-number", ["coalesce", ["get", "CATOBS"], 0], 0],
          ["literal", [6, 7]],
        ],
      ] as unknown as ExpressionSpecification,
      paint: {
        "fill-pattern": ctx.icon("foul-pattern"),
      },
    },
    {
      id: "s57-obstrn-foul-outline",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "OBSTRN",
      minzoom: 10,
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        [
          "in",
          ["to-number", ["coalesce", ["get", "CATOBS"], 0], 0],
          ["literal", [6, 7]],
        ],
      ] as unknown as ExpressionSpecification,
      paint: {
        "line-color": ctx.colour("CHGRD"),
        "line-width": 1,
        "line-dasharray": [4, 2],
        "line-opacity": 0.6,
      },
    },
    // Obstructions — line (piling rows, submerged walls, etc.)
    {
      id: "s57-obstrn-line",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "OBSTRN",
      minzoom: 11,
      filter: [
        "==",
        ["geometry-type"],
        "LineString",
      ] as unknown as ExpressionSpecification,
      paint: {
        "line-color": ctx.colour("CHBLK"),
        "line-width": 1.5,
        "line-dasharray": [2, 2] as number[],
      },
    },
    // Obstructions — point symbols
    {
      id: "s57-obstrn",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "OBSTRN",
      minzoom: 10,
      filter: [
        "==",
        ["geometry-type"],
        "Point",
      ] as unknown as ExpressionSpecification,
      layout: withOffset(
        {
          "symbol-sort-key": SORT_KEY_HAZARD,
          "icon-image": obstrn.iconExpr,
          "icon-size": scaledSize(
            [
              "interpolate",
              ["linear"],
              ["zoom"],
              10,
              0.45,
              13,
              0.65,
            ] as unknown as ExpressionSpecification,
            ctx,
          ),
          "icon-allow-overlap": [
            "step",
            ["zoom"],
            false,
            13,
            true,
          ] as unknown as ExpressionSpecification,
          // Don't push labels away from obstructions — see UWTROC comment.
          "icon-ignore-placement": true,
          "icon-padding": 2,
        },
        obstrn.offsetExpr,
      ),
      paint: {},
    },
    // Obstructions — VALSOU depth sounding (shown inside dotted oval)
    {
      id: "s57-obstrn-sounding",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "OBSTRN",
      minzoom: 12,
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        ["has", "VALSOU"],
      ] as unknown as ExpressionSpecification,
      layout: {
        "text-field": valsouTextField(ctx.depthUnit),
        "text-size": scaledTextSize(11, ctx),
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": ctx.colour("SNDG2"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1,
      },
    },
    // Underwater rocks
    {
      id: "s57-uwtroc",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "UWTROC",
      minzoom: 10,
      layout: withOffset(
        {
          "symbol-sort-key": SORT_KEY_HAZARD,
          "icon-image": uwtroc.iconExpr,
          "icon-size": scaledSize(
            [
              "interpolate",
              ["linear"],
              ["zoom"],
              10,
              0.45,
              13,
              0.65,
            ] as unknown as ExpressionSpecification,
            ctx,
          ),
          "icon-allow-overlap": [
            "step",
            ["zoom"],
            false,
            13,
            true,
          ] as unknown as ExpressionSpecification,
          // Hazard icons are safety-critical (allow-overlap at z13+) but
          // shouldn't block *other* labels from placing nearby — a ring of
          // UWTROCs around an island would otherwise force the LNDMRK name
          // off the screen. ``ignore-placement: true`` lets the asterisks
          // always show and still leaves room for neighbours.
          "icon-ignore-placement": true,
          "icon-padding": 2,
        },
        uwtroc.offsetExpr,
      ),
      paint: {},
    },
    // Underwater rocks — VALSOU depth sounding
    {
      id: "s57-uwtroc-sounding",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "UWTROC",
      minzoom: 12,
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        ["has", "VALSOU"],
      ] as unknown as ExpressionSpecification,
      layout: {
        "text-field": valsouTextField(ctx.depthUnit),
        "text-size": scaledTextSize(11, ctx),
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": ctx.colour("SNDG2"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1,
      },
    },

    // Weed/kelp — WEDKLP point symbol
    {
      id: "s57-wedklp",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "WEDKLP",
      minzoom: 11,
      filter: [
        "==",
        ["geometry-type"],
        "Point",
      ] as unknown as ExpressionSpecification,
      layout: {
        "icon-image": "WEDKLP01",
        "icon-size": 0.7,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    // Weed/kelp — area outline
    {
      id: "s57-wedklp-outline",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "WEDKLP",
      minzoom: 11,
      filter: [
        "==",
        ["geometry-type"],
        "Polygon",
      ] as unknown as ExpressionSpecification,
      paint: {
        "line-color": ctx.colour("CHGRD"),
        "line-width": 1,
        "line-dasharray": [4, 2],
        "line-opacity": 0.5,
      },
    },

    // Sand waves — SNDWAV point symbol
    {
      id: "s57-sndwav",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "SNDWAV",
      minzoom: 11,
      layout: {
        "icon-image": "SNDWAV02",
        "icon-size": 0.7,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    // Spring in seabed — SPRING point symbol
    {
      id: "s57-spring",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "SPRING",
      minzoom: 11,
      layout: {
        "icon-image": "SPRING02",
        "icon-size": 0.7,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    // Current arrows — CURENT point symbol with rotation
    {
      id: "s57-curent",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "CURENT",
      minzoom: 10,
      layout: {
        "icon-image": "CURENT01",
        "icon-size": 0.7,
        "icon-rotate": [
          "to-number",
          ["coalesce", ["get", "ORIENT"], 0],
          0,
        ] as unknown as ExpressionSpecification,
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    // Light float — LITFLT point symbol
    {
      id: "s57-litflt",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "LITFLT",
      minzoom: 10,
      layout: {
        "icon-image": "LITFLT02",
        "icon-size": 0.8,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    // Light vessel — LITVES point symbol
    {
      id: "s57-litves",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "LITVES",
      minzoom: 10,
      layout: {
        "icon-image": "LITVES02",
        "icon-size": 0.8,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    // Radio calling-in point — RDOCAL
    {
      id: "s57-rdocal",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "RDOCAL",
      minzoom: 10,
      layout: {
        "icon-image": "RDOCAL02",
        "icon-size": 0.7,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    // Rescue station — RSCSTA
    {
      id: "s57-rscsta",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "RSCSTA",
      minzoom: 10,
      layout: {
        "icon-image": "RSCSTA02",
        "icon-size": 0.7,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    // Signal station — SISTAT
    {
      id: "s57-sistat",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "SISTAT",
      minzoom: 10,
      layout: {
        "icon-image": "SISTAT03",
        "icon-size": 0.7,
        "icon-allow-overlap": true,
      },
      paint: {},
    },

    // Radar reflector — RETRFL
    {
      id: "s57-retrfl",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "RETRFL",
      minzoom: 10,
      layout: {
        "icon-image": "RETRFL02",
        "icon-size": 0.7,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    // Radar transponder beacon — RTPBCN
    {
      id: "s57-rtpbcn",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "RTPBCN",
      minzoom: 10,
      layout: {
        "icon-image": ctx.icon("radar-transponder"),
        "icon-size": 0.7,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    // Radio station — RDOSTA
    {
      id: "s57-rdosta",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "RDOSTA",
      minzoom: 10,
      layout: {
        "icon-image": ctx.icon("radio-station"),
        "icon-size": 0.7,
        "icon-allow-overlap": true,
        "text-field": [
          "case",
          ["any", ["==", ["get", "CATROS"], 7], ["==", ["get", "CATROS"], "7"]],
          "DGPS",
          "",
        ] as unknown as ExpressionSpecification,
        "text-size": scaledTextSize(10, ctx),
        "text-offset": [0, 1.5],
        "text-font": ["Noto Sans Regular"],
        "text-optional": true,
      },
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1,
      },
    },
    // Gate/lock — GATCON
    {
      id: "s57-gatcon-symbol",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "GATCON",
      minzoom: ctx.detailMinzoom(12),
      layout: {
        "icon-image": [
          "case",
          ["==", ["get", "CATGAT"], 3],
          ctx.icon("gate-navigable"),
          ctx.icon("gate-non-navigable"),
        ] as unknown as ExpressionSpecification,
        "icon-size": 0.7,
        "icon-allow-overlap": true,
      },
      paint: {},
    },

    // Isolated danger overlays (S-52 UDWHAZ05): magenta diamond symbol
    // for hazards with depth ≤ safetyDepth that lie in safe water
    // (_enclosing_depth ≥ safetyDepth). Added by pipeline enrichment.
    ...isolatedDangerLayers(ctx),
  ];
}

/** Isolated danger overlay layers for WRECKS, OBSTRN, UWTROC. */
function isolatedDangerLayers(ctx: StyleContext): LayerSpecification[] {
  const filter: ExpressionSpecification = [
    "all",
    ["has", "_enclosing_depth"],
    ["has", "VALSOU"],
    ["<=", ["get", "VALSOU"], ctx.safetyDepth],
    [">=", ["get", "_enclosing_depth"], ctx.safetyDepth],
  ] as unknown as ExpressionSpecification;

  return (["WRECKS", "OBSTRN", "UWTROC"] as const).map((layer) => ({
    id: `s57-${layer.toLowerCase()}-isodgr`,
    type: "symbol" as const,
    source: ctx.sourceId,
    "source-layer": layer,
    minzoom: 10,
    filter,
    layout: {
      "icon-image": ctx.icon("isolated-danger-symbol"),
      "icon-size": scaledSize(0.7, ctx) as number,
      "icon-allow-overlap": true,
    },
    paint: {},
  }));
}

/** Other nav aid layers: fog signals, pilings, mooring, special beacons, seabed. */
export function getOtherNavAidLayers(ctx: StyleContext): LayerSpecification[] {
  const fogsig = ctx.layerExprs("FOGSIG");
  const pilpnt = ctx.layerExprs("PILPNT");
  const morfac = ctx.layerExprs("MORFAC");
  const bcnspp = ctx.layerExprs("BCNSPP");

  return [
    // Fog signals — S-52 CS(FOGSIG02): icon only, details via cursor pick
    {
      id: "s57-fogsig",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "FOGSIG",
      minzoom: 6,
      layout: withOffset(
        {
          "symbol-sort-key": SORT_KEY_NAVAID,
          "icon-image": fogsig.iconExpr,
          "icon-size": scaledSize(0.6, ctx),
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        fogsig.offsetExpr,
      ),
      paint: {},
    },
    // Pilings
    {
      id: "s57-pilpnt",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "PILPNT",
      minzoom: ctx.detailMinzoom(13),
      layout: withOffset(
        {
          "symbol-sort-key": SORT_KEY_NAVAID,
          "icon-image": pilpnt.iconExpr,
          "icon-size": scaledSize(0.6, ctx),
          "icon-allow-overlap": true,
        },
        pilpnt.offsetExpr,
      ),
      paint: {},
    },
    // Mooring facilities
    {
      id: "s57-morfac",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "MORFAC",
      minzoom: ctx.detailMinzoom(12),
      layout: withOffset(
        {
          "symbol-sort-key": SORT_KEY_NAVAID,
          "icon-image": morfac.iconExpr,
          "icon-size": scaledSize(0.5, ctx),
          "icon-allow-overlap": true,
        },
        morfac.offsetExpr,
      ),
      paint: {},
    },

    // Special purpose beacons
    {
      id: "s57-bcnspp",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BCNSPP",
      minzoom: 8,
      layout: withOffset(
        {
          "symbol-sort-key": SORT_KEY_NAVAID,
          "icon-image": bcnspp.iconExpr,
          "icon-size": scaledSize(0.7, ctx),
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": LABEL_EXPR,
          "text-size": scaledTextSize(11, ctx),
          "text-offset": [0, 1.5],
          "text-allow-overlap": false,
          "text-optional": true,
        },
        bcnspp.offsetExpr,
      ),
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1.5,
      },
    },

    // Seabed area labels
    {
      id: "s57-sbdare",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "SBDARE",
      minzoom: ctx.detailMinzoom(12),
      layout: {
        "text-field": ["get", "LABEL"],
        "text-size": scaledTextSize(10, ctx),
        "text-font": ["Noto Sans Italic"],
        "text-allow-overlap": false,
        "text-padding": 5,
      },
      paint: {
        "text-color": ctx.colour("CHGRD"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1,
      },
    },
  ];
}

/** OTHER-category point layers: facilities, platforms, magvar, etc. */
export function getOtherPointLayers(ctx: StyleContext): LayerSpecification[] {
  const siltnk = ctx.layerExprs("SILTNK");
  const hrbfac = ctx.layerExprs("HRBFAC");
  const ofsplf = ctx.layerExprs("OFSPLF");

  return [
    {
      id: "s57-dmpgrd",
      type: "fill" as const,
      source: ctx.sourceId,
      "source-layer": "DMPGRD",
      paint: {
        "fill-color": ctx.colour("CHMGD"),
        "fill-opacity": 0.12,
      },
    },
    {
      id: "s57-dmpgrd-outline",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "DMPGRD",
      paint: {
        "line-color": ctx.colour("CHMGD"),
        "line-width": 1,
        "line-dasharray": [4, 3] as number[],
      },
    },
    // Spoil ground — SPLARE
    {
      id: "s57-splare",
      type: "fill" as const,
      source: ctx.sourceId,
      "source-layer": "SPLARE",
      paint: {
        "fill-color": ctx.colour("CHMGD"),
        "fill-opacity": 0.12,
      },
    },
    {
      id: "s57-splare-symbol",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "SPLARE",
      minzoom: ctx.detailMinzoom(10),
      layout: {
        "icon-image": ctx.icon("info-area"),
        "icon-size": 0.5,
        "icon-allow-overlap": true,
      },
      paint: {
        "icon-opacity": 0.75,
      },
    },
    {
      id: "s57-splare-outline",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "SPLARE",
      paint: {
        "line-color": ctx.colour("CHMGD"),
        "line-width": 1,
        "line-dasharray": [4, 2] as number[],
      },
    },
    {
      id: "s57-siltnk",
      type: "fill" as const,
      source: ctx.sourceId,
      "source-layer": "SILTNK",
      minzoom: ctx.detailMinzoom(13),
      paint: {
        "fill-color": ctx.colour("CHBRN"),
        "fill-opacity": 0.3,
      },
    },
    {
      id: "s57-siltnk-outline",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "SILTNK",
      minzoom: ctx.detailMinzoom(13),
      paint: {
        "line-color": ctx.colour("CHBLK"),
        "line-width": 1,
      },
    },
    {
      id: "s57-siltnk-icon",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "SILTNK",
      minzoom: ctx.detailMinzoom(13),
      layout: withOffset(
        {
          "icon-image": siltnk.iconExpr,
          "icon-size": scaledSize(0.5, ctx),
          "icon-allow-overlap": true,
        },
        siltnk.offsetExpr,
      ),
      paint: {},
    },
    {
      id: "s57-hrbfac",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "HRBFAC",
      minzoom: ctx.detailMinzoom(13),
      layout: withOffset(
        {
          ...VARIABLE_ANCHOR_LAYOUT,
          "symbol-sort-key": SORT_KEY_FACILITY,
          "icon-image": hrbfac.iconExpr,
          "icon-size": scaledSize(0.6, ctx),
          "icon-allow-overlap": true,
          "text-field": ["get", "OBJNAM"] as unknown as ExpressionSpecification,
          "text-size": scaledTextSize(10, ctx),
          "text-allow-overlap": false,
          "text-optional": true,
        },
        hrbfac.offsetExpr,
      ),
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1,
      },
    },
    {
      id: "s57-ofsplf",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "OFSPLF",
      layout: withOffset(
        {
          "icon-image": ofsplf.iconExpr,
          "icon-size": scaledSize(0.6, ctx),
          "icon-allow-overlap": true,
        },
        ofsplf.offsetExpr,
      ),
      paint: {},
    },
    // MAGVAR (magnetic variation) — disabled for now. Plain text labels
    // are confusing without context. Future: render as compass-rose vectors
    // at low zoom (z7 and below) for navigation use. See PLAN.md.
  ];
}

/** Additional point layers: pilot boarding, water turbulence, fishing, cranes, etc. */
export function getAdditionalPointLayers(
  ctx: StyleContext,
): LayerSpecification[] {
  const pilbop = ctx.layerExprs("PILBOP");
  const cranes = ctx.layerExprs("CRANES");

  return [
    // Pilot Boarding Place — area fill (S-52: LS(DASH,2,TRFCF))
    {
      id: "s57-pilbop",
      type: "fill" as const,
      source: ctx.sourceId,
      "source-layer": "PILBOP",
      filter: [
        "==",
        ["geometry-type"],
        "Polygon",
      ] as unknown as ExpressionSpecification,
      paint: {
        "fill-color": ctx.colour("TRFCF"),
        "fill-opacity": 0.06,
      },
    },
    {
      id: "s57-pilbop-outline",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "PILBOP",
      filter: [
        "==",
        ["geometry-type"],
        "Polygon",
      ] as unknown as ExpressionSpecification,
      paint: {
        "line-color": ctx.colour("TRFCF"),
        "line-width": 2,
        "line-dasharray": [6, 3] as number[],
      },
    },
    // Pilot Boarding Place — area label at centroid (S-52: SY(PILBOP02) + text)
    {
      id: "s57-pilbop-label",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "PILBOP",
      filter: [
        "==",
        ["geometry-type"],
        "Polygon",
      ] as unknown as ExpressionSpecification,
      layout: {
        ...VARIABLE_ANCHOR_LAYOUT,
        "symbol-sort-key": SORT_KEY_FACILITY,
        "text-field": [
          "case",
          ["has", "OBJNAM"],
          ["concat", "Plt ", ["get", "OBJNAM"]],
          "Plt",
        ] as unknown as ExpressionSpecification,
        "text-size": scaledTextSize(10, ctx),
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1,
      },
    },
    // Pilot Boarding Place — point symbol (S-52: SY(PILBOP02) + TE('Plt %s'))
    {
      id: "s57-pilbop-point",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "PILBOP",
      filter: [
        "==",
        ["geometry-type"],
        "Point",
      ] as unknown as ExpressionSpecification,
      layout: withOffset(
        {
          ...VARIABLE_ANCHOR_LAYOUT,
          "symbol-sort-key": SORT_KEY_FACILITY,
          "icon-image": pilbop.iconExpr,
          "icon-size": scaledSize(0.6, ctx),
          "icon-allow-overlap": true,
          "text-field": [
            "case",
            ["has", "OBJNAM"],
            ["concat", "Plt ", ["get", "OBJNAM"]],
            "Plt",
          ] as unknown as ExpressionSpecification,
          "text-size": scaledTextSize(10, ctx),
          "text-allow-overlap": false,
          "text-optional": true,
        },
        pilbop.offsetExpr,
      ),
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1,
      },
    },
    // Water Turbulence — polygon outline (S-52: LS(DASH,1,CHGRD))
    {
      id: "s57-wattur-outline",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "WATTUR",
      minzoom: 12,
      filter: [
        "==",
        ["geometry-type"],
        "Polygon",
      ] as unknown as ExpressionSpecification,
      paint: {
        "line-color": ctx.colour("CHGRD"),
        "line-width": 1,
        "line-dasharray": [4, 2] as number[],
      },
    },
    // Water Turbulence — centered symbol on polygon + point (S-52: SY(WATTUR02))
    {
      id: "s57-wattur",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "WATTUR",
      minzoom: 12,
      layout: {
        "icon-image": ctx.icon("water-turbulence"),
        "icon-size": scaledSize(0.7, ctx) as number,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    // Fishing Facility — SY(FSHFAC02) + line/area outline
    {
      id: "s57-fshfac",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "FSHFAC",
      minzoom: ctx.detailMinzoom(11),
      layout: {
        "icon-image": "FSHFAC02",
        "icon-size": 0.7,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    {
      id: "s57-fshfac-line",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "FSHFAC",
      minzoom: ctx.detailMinzoom(11),
      filter: [
        "in",
        ["geometry-type"],
        ["literal", ["LineString", "Polygon"]],
      ] as unknown as ExpressionSpecification,
      paint: {
        "line-color": ctx.colour("CHGRD"),
        "line-width": 1,
        "line-dasharray": [4, 2],
      },
    },
    // Pylons (bridge supports — small subtle dots, subordinate to bridge line)
    {
      id: "s57-pylons",
      type: "circle" as const,
      source: ctx.sourceId,
      "source-layer": "PYLONS",
      minzoom: ctx.detailMinzoom(14),
      paint: {
        "circle-radius": 2,
        "circle-color": ctx.colour("CHGRD"),
        "circle-stroke-width": 0,
      },
    },
    // Cranes
    {
      id: "s57-cranes",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "CRANES",
      minzoom: ctx.detailMinzoom(13),
      layout: withOffset(
        {
          "icon-image": cranes.iconExpr,
          "icon-size": scaledSize(0.5, ctx),
          "icon-allow-overlap": true,
        },
        cranes.offsetExpr,
      ),
      paint: {},
    },
    // Coast Guard Station
    {
      id: "s57-cgusta",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "CGUSTA",
      minzoom: ctx.detailMinzoom(12),
      layout: {
        ...VARIABLE_ANCHOR_LAYOUT,
        "symbol-sort-key": SORT_KEY_FACILITY,
        "text-field": ["get", "OBJNAM"] as unknown as ExpressionSpecification,
        "text-size": scaledTextSize(10, ctx),
        "text-allow-overlap": false,
        "text-optional": true,
      },
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("NAIDH"),
        "text-halo-width": 1,
      },
    },
  ];
}

/** OTHER-category daymarks and topmarks. */
export function getDaymarkTopmarkLayers(
  ctx: StyleContext,
): LayerSpecification[] {
  const daymar = ctx.layerExprs("DAYMAR");
  const topmar = ctx.layerExprs("TOPMAR");

  return [
    {
      id: "s57-daymar",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "DAYMAR",
      layout: withOffset(
        {
          "icon-image": daymar.iconExpr,
          "icon-size": scaledSize(0.75, ctx),
          "icon-allow-overlap": true,
        },
        daymar.offsetExpr,
      ),
      paint: {},
    },
    {
      id: "s57-topmar",
      type: "symbol" as const,
      source: ctx.sourceId,
      "source-layer": "TOPMAR",
      layout: withOffset(
        {
          "icon-image": topmar.iconExpr,
          "icon-size": scaledSize(0.7, ctx),
          "icon-allow-overlap": true,
          // For Pelorus Standard, topmarks are shifted up to sit above beacons.
          // For S-52, the per-symbol offset expression handles this.
          ...(topmar.offsetExpr
            ? {}
            : { "icon-offset": [0, -10] as [number, number] }),
        },
        topmar.offsetExpr,
      ),
      paint: {},
    },
  ];
}
