/**
 * Text/label layer definitions: place names, feature labels,
 * landmarks (icon + text), berth names.
 *
 * Note: LNDMRK is a symbol layer with both icon and text, but lives
 * here because it is interleaved with text-only labels in the draw order.
 */
import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";
import type { StyleContext } from "../style-context";

export function getTextLayers(ctx: StyleContext): LayerSpecification[] {
  return [
    // ── Geographic labels ─────────────────────────────────────────────
    {
      id: "s57-lndare-label",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "LNDARE",
      minzoom: ctx.detailMinzoom(11),
      filter: ["has", "OBJNAM"],
      layout: {
        "text-field": ["get", "OBJNAM"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          11,
          10,
          14,
          13,
        ] as unknown as number,
        "text-font": ["Noto Sans Italic"],
        "text-allow-overlap": false,
        "text-padding": 10,
      },
      paint: {
        "text-color": ctx.colour("NINFO"),
        "text-halo-color": ctx.colour("LANDA"),
        "text-halo-width": 1.5,
      },
    },
    // Landmarks (lighthouses, monuments, towers, chimneys, windmills)
    {
      id: "s57-lndmrk",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "LNDMRK",
      minzoom: ctx.detailMinzoom(12),
      layout: {
        "icon-image": ctx.iconExpr,
        "icon-size": 0.6 * ctx.iconSizeScale,
        "icon-allow-overlap": true,
        ...(ctx.iconOffsetExpr ? { "icon-offset": ctx.iconOffsetExpr } : {}),
        "text-field": ["get", "OBJNAM"] as unknown as ExpressionSpecification,
        "text-size": 11,
        "text-allow-overlap": false,
        "text-optional": true,
        "text-anchor": "top" as const,
        "text-offset": [0, 1.2] as [number, number],
      },
      paint: {
        "text-color": ctx.colour("CHBLK"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1.5,
      },
    },
    {
      id: "s57-berths-label",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "BERTHS",
      minzoom: ctx.detailMinzoom(13),
      filter: ["has", "OBJNAM"],
      layout: {
        "text-field": ["get", "OBJNAM"],
        "text-size": 10,
        "text-allow-overlap": false,
        "text-padding": 5,
      },
      paint: {
        "text-color": ctx.colour("CHGRF"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1,
      },
    },
    {
      id: "s57-seaare-label",
      type: "symbol",
      source: ctx.sourceId,
      "source-layer": "SEAARE",
      minzoom: ctx.detailMinzoom(10),
      filter: ["has", "OBJNAM"],
      layout: {
        "text-field": ["get", "OBJNAM"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          10,
          14,
          12,
        ] as unknown as number,
        "text-font": ["Noto Sans Italic"],
        "text-allow-overlap": false,
        "text-padding": 10,
      },
      paint: {
        "text-color": ctx.colour("BKAJ1"),
        "text-halo-color": ctx.colour("CHWHT"),
        "text-halo-width": 1.5,
      },
    },
  ];
}
