/**
 * Line layer definitions: depth contours, coastline, shoreline constructions,
 * bridges, cables, pipelines.
 */
import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";
import { depthConversionFactor, depthUnitLabel } from "../../../settings";
import type { StyleContext } from "../style-context";
import { SCALE_SORT_KEY, scaledTextSize } from "../style-context";

/**
 * Build a text-field expression that converts VALDCO (meters) to the
 * user's depth unit and appends the unit suffix.
 * VALDCO may be missing — show nothing in that case.
 */
function depthContourLabel(ctx: StyleContext): ExpressionSpecification {
  const factor = depthConversionFactor(ctx.depthUnit);
  const suffix = depthUnitLabel(ctx.depthUnit);
  const converted: ExpressionSpecification = ["*", ["get", "VALDCO"], factor];
  // Feet/fathoms: floor for safety (shoaler reading). Meters: 1 decimal.
  const usesDecimals = ctx.depthUnit === "meters";
  const value: ExpressionSpecification = usesDecimals
    ? ["number-format", converted, { "max-fraction-digits": 1 }]
    : ["number-format", ["floor", converted], { "max-fraction-digits": 0 }];
  return [
    "case",
    ["has", "VALDCO"],
    ["concat", value, suffix === "m" ? "" : suffix],
    "",
  ];
}

export function getLineLayers(ctx: StyleContext): LayerSpecification[] {
  const layers: LayerSpecification[] = [
    {
      id: "s57-depcnt",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "DEPCNT",
      layout: { "line-sort-key": SCALE_SORT_KEY },
      paint: {
        "line-color": ctx.colour("CHGRD"),
        "line-width": 0.7,
      },
    },
    {
      id: "s57-depcnt-safety",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "DEPCNT",
      filter: ["==", ["get", "VALDCO"], -1], // placeholder — updated at runtime by SafetyContour
      layout: { "line-sort-key": SCALE_SORT_KEY },
      paint: {
        "line-color": ctx.colour("DEPSC"),
        "line-width": 1.5,
      },
    },
    {
      id: "s57-depcnt-label",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "DEPCNT",
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 100,
        "text-field": depthContourLabel(ctx),
        "text-size": scaledTextSize(11, ctx),
        "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
        "text-anchor": "center",
        "text-keep-upright": true,
        "text-max-angle": 30,
      },
      paint: {
        "text-color": ctx.colour("CHGRD"),
        "text-halo-color": ctx.colour("DEPMD"),
        "text-halo-width": 1.5,
      },
    },
    {
      id: "s57-slcons",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "SLCONS",
      layout: { "line-sort-key": SCALE_SORT_KEY },
      paint: {
        "line-color": ctx.colour("CHGRF"),
        // Breakwater/seawall (CATSLC=1,3) thicker; wharf (4) normal
        "line-width": [
          "match",
          ["coalesce", ["get", "CATSLC"], 0],
          1,
          2.5, // breakwater
          3,
          2.5, // seawall
          1,
        ] as unknown as ExpressionSpecification,
      },
    },
    {
      id: "s57-bridge",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "BRIDGE",
      paint: {
        "line-color": ctx.colour("CHBRN"),
        "line-width": 2,
      },
    },
    // Opening bridge symbol — SY(BRIDGE01) concentric circles
    // S-57 CATBRG codes for opening bridges:
    //   2=opening, 3=swing, 4=lifting, 5=bascule, 7=drawbridge, 9=draw
    {
      id: "s57-bridge-opening",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BRIDGE",
      minzoom: ctx.detailMinzoom(12),
      filter: [
        "any",
        ...[
          "2", // opening
          "3", // swing
          "4", // lifting
          "5", // bascule
          "7", // drawbridge
          "9", // draw
        ].map((v) => [
          "in",
          `,${v},`,
          [
            "concat",
            ",",
            ["to-string", ["coalesce", ["get", "CATBRG"], ""]],
            ",",
          ],
        ]),
      ] as unknown as ExpressionSpecification,
      layout: {
        "icon-image": ctx.icon("bridge-symbol"),
        "icon-size": 0.7,
        "icon-allow-overlap": true,
      },
      paint: {},
    },
    // Bridge clearance labels (D23) — separate layers for line vs polygon geometry
    ...((): LayerSpecification[] => {
      const hasClr = [
        "any",
        ["has", "VERCLR"],
        ["has", "VERCCL"],
        ["has", "VERCOP"],
      ] as unknown as ExpressionSpecification;
      const clrText = [
        "case",
        ["has", "VERCOP"],
        [
          "concat",
          "clr ",
          ["to-string", ["get", "VERCCL"]],
          "/",
          ["to-string", ["get", "VERCOP"]],
          "m",
        ],
        ["has", "VERCLR"],
        ["concat", "clr ", ["to-string", ["get", "VERCLR"]], "m"],
        ["has", "VERCCL"],
        ["concat", "clr ", ["to-string", ["get", "VERCCL"]], "m"],
        "",
      ] as unknown as ExpressionSpecification;
      const paint = {
        "text-color": ctx.colour("CHBRN"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1,
      };
      return [
        {
          id: "s57-bridge-label",
          type: "symbol",
          source: ctx.sourceId,
          "source-layer": "BRIDGE",
          minzoom: ctx.detailMinzoom(13),
          filter: [
            "all",
            hasClr,
            ["!=", ["geometry-type"], "LineString"],
          ] as unknown as ExpressionSpecification,
          layout: {
            "text-field": clrText,
            "text-size": scaledTextSize(10, ctx),
            "text-font": ["Noto Sans Regular"],
            "text-allow-overlap": false,
            "text-anchor": "top",
            "text-offset": [0, 0.5],
          },
          paint,
        },
        {
          id: "s57-bridge-label-line",
          type: "symbol",
          source: ctx.sourceId,
          "source-layer": "BRIDGE",
          minzoom: ctx.detailMinzoom(13),
          filter: [
            "all",
            hasClr,
            ["==", ["geometry-type"], "LineString"],
          ] as unknown as ExpressionSpecification,
          layout: {
            "symbol-placement": "line-center",
            "text-field": clrText,
            "text-size": scaledTextSize(10, ctx),
            "text-font": ["Noto Sans Regular"],
            "text-allow-overlap": false,
          },
          paint,
        },
      ];
    })(),
    {
      id: "s57-cblsub",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "CBLSUB",
      paint: {
        "line-color": ctx.colour("ISDNG"),
        "line-width": 1,
        "line-dasharray": [4, 3],
      },
    },
    {
      id: "s57-cblohd",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "CBLOHD",
      paint: {
        "line-color": ctx.colour("OUTLW"),
        "line-width": 1.2,
        "line-dasharray": [5, 3],
      },
    },
    // Overhead cable clearance label (D26–D27)
    // VERCLR = vertical clearance, VERCSA = safe vertical clearance
    {
      id: "s57-cblohd-label",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "CBLOHD",
      minzoom: ctx.detailMinzoom(14),
      filter: ["any", ["has", "VERCLR"], ["has", "VERCSA"]],
      layout: {
        "symbol-placement": "line-center",
        "text-field": [
          "case",
          ["has", "VERCSA"],
          ["concat", "sf clr ", ["to-string", ["get", "VERCSA"]], "m"],
          ["concat", "clr ", ["to-string", ["get", "VERCLR"]], "m"],
        ] as unknown as ExpressionSpecification,
        "text-size": scaledTextSize(10, ctx),
        "text-font": ["Noto Sans Regular"],
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1,
      },
    },
    // Overhead pipeline — PIPOHD (same style as CBLOHD)
    {
      id: "s57-pipohd",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "PIPOHD",
      paint: {
        "line-color": ctx.colour("OUTLW"),
        "line-width": 1.2,
        "line-dasharray": [5, 3],
      },
    },
    // Overhead pipeline clearance label
    {
      id: "s57-pipohd-label",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "PIPOHD",
      minzoom: ctx.detailMinzoom(14),
      filter: ["any", ["has", "VERCLR"], ["has", "VERCSA"]],
      layout: {
        "symbol-placement": "line-center",
        "text-field": [
          "case",
          ["has", "VERCSA"],
          ["concat", "sf clr ", ["to-string", ["get", "VERCSA"]], "m"],
          ["concat", "clr ", ["to-string", ["get", "VERCLR"]], "m"],
        ] as unknown as ExpressionSpecification,
        "text-size": scaledTextSize(10, ctx),
        "text-font": ["Noto Sans Regular"],
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1,
      },
    },
    // Sloping ground / cliff — SLOGRD
    {
      id: "s57-slogrd",
      type: "line",
      source: ctx.sourceId,
      "source-layer": "SLOGRD",
      paint: {
        "line-color": ctx.colour("CHBRN"),
        "line-width": 1.5,
      },
    },
  ];

  return layers;
}

/** STANDARD-category additional line layers: dykes, slopes, gates, dams. */
export function getAdditionalLineLayers(
  ctx: StyleContext,
): LayerSpecification[] {
  return [
    {
      id: "s57-dykcon",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "DYKCON",
      paint: {
        "line-color": ctx.colour("CHBRN"),
        "line-width": 1.5,
      },
    },
    {
      id: "s57-slotop",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "SLOTOP",
      paint: {
        "line-color": ctx.colour("CHBRN"),
        "line-width": 1,
        "line-dasharray": [3, 2] as number[],
      },
    },
    {
      id: "s57-gatcon",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "GATCON",
      paint: {
        "line-color": ctx.colour("CHBLK"),
        "line-width": 2,
      },
    },
    {
      id: "s57-damcon",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "DAMCON",
      paint: {
        "line-color": ctx.colour("CHBLK"),
        "line-width": 1.5,
      },
    },
  ];
}

/** OTHER-category line layers: cable areas, pipe areas, pipelines. */
export function getOtherLineLayers(ctx: StyleContext): LayerSpecification[] {
  return [
    {
      id: "s57-cblare",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "CBLARE",
      paint: {
        "line-color": ctx.colour("ISDNG"),
        "line-width": 1,
        "line-dasharray": [4, 3] as number[],
        "line-opacity": 0.5,
      },
    },
    {
      id: "s57-pipare",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "PIPARE",
      paint: {
        "line-color": ctx.colour("ISDNG"),
        "line-width": 1,
        "line-dasharray": [4, 3] as number[],
        "line-opacity": 0.5,
      },
    },
    {
      id: "s57-pipsol",
      type: "line" as const,
      source: ctx.sourceId,
      "source-layer": "PIPSOL",
      paint: {
        "line-color": ctx.colour("ISDNG"),
        "line-width": 1,
        "line-dasharray": [4, 3] as number[],
      },
    },
  ];
}
