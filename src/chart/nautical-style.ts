import type { LayerSpecification } from "maplibre-gl";

/**
 * Minimal nautical chart style layers for S-57 vector tiles.
 * Simplified symbology — full S-52 symbology with sprites is deferred to Phase 1C.
 *
 * Layer ordering:
 *   1. Background
 *   2. Fill layers — terrain first, then regulatory overlays
 *   3. Line layers
 *   4. Point/symbol layers
 */
export function getNauticalLayers(sourceId: string): LayerSpecification[] {
  return [
    // ── Background ──────────────────────────────────────────────────────
    // Ocean background — visible where no DEPARE polygons exist
    {
      id: "s57-background",
      type: "background",
      paint: {
        "background-color": "#d4e8f7",
      },
    },

    // ── Fill layers: terrain ────────────────────────────────────────────
    // Land areas — tan fill
    {
      id: "s57-lndare",
      type: "fill",
      source: sourceId,
      "source-layer": "LNDARE",
      paint: {
        "fill-color": "#f5e6c8",
        "fill-opacity": 1,
      },
    },
    // Depth areas — blue shading by depth
    {
      id: "s57-depare-shallow",
      type: "fill",
      source: sourceId,
      "source-layer": "DEPARE",
      filter: ["<", ["get", "DRVAL1"], 5],
      paint: {
        "fill-color": "#a8ccee",
        "fill-opacity": 0.9,
      },
    },
    {
      id: "s57-depare-medium",
      type: "fill",
      source: sourceId,
      "source-layer": "DEPARE",
      filter: [
        "all",
        [">=", ["get", "DRVAL1"], 5],
        ["<", ["get", "DRVAL1"], 20],
      ],
      paint: {
        "fill-color": "#c4ddf5",
        "fill-opacity": 0.9,
      },
    },
    {
      id: "s57-depare-deep",
      type: "fill",
      source: sourceId,
      "source-layer": "DEPARE",
      filter: [">=", ["get", "DRVAL1"], 20],
      paint: {
        "fill-color": "#d4e8f7",
        "fill-opacity": 0.9,
      },
    },
    // Drying areas (covers and uncovers at tide) — green per chart convention
    {
      id: "s57-depare-drying",
      type: "fill",
      source: sourceId,
      "source-layer": "DEPARE",
      filter: ["<", ["get", "DRVAL1"], 0],
      paint: {
        "fill-color": "#8cbc8c",
        "fill-opacity": 0.9,
      },
    },
    // Lake areas — light blue like shallow water
    {
      id: "s57-lakare",
      type: "fill",
      source: sourceId,
      "source-layer": "LAKARE",
      paint: {
        "fill-color": "#a8ccee",
        "fill-opacity": 0.8,
      },
    },
    // Rivers — light blue
    {
      id: "s57-rivers",
      type: "fill",
      source: sourceId,
      "source-layer": "RIVERS",
      paint: {
        "fill-color": "#a8ccee",
        "fill-opacity": 0.8,
      },
    },
    // Dredged areas — light gray-blue with dashed outline
    {
      id: "s57-drgare",
      type: "fill",
      source: sourceId,
      "source-layer": "DRGARE",
      paint: {
        "fill-color": "#c8d8e8",
        "fill-opacity": 0.5,
      },
    },
    {
      id: "s57-drgare-outline",
      type: "line",
      source: sourceId,
      "source-layer": "DRGARE",
      paint: {
        "line-color": "#8899aa",
        "line-width": 1,
        "line-dasharray": [4, 3],
      },
    },
    // Pontoons / floating docks — light gray fill
    {
      id: "s57-ponton",
      type: "fill",
      source: sourceId,
      "source-layer": "PONTON",
      paint: {
        "fill-color": "#cccccc",
        "fill-opacity": 0.8,
      },
    },
    // Buildings — brown fill
    {
      id: "s57-buisgl",
      type: "fill",
      source: sourceId,
      "source-layer": "BUISGL",
      paint: {
        "fill-color": "#b5926b",
        "fill-opacity": 0.7,
      },
    },
    {
      id: "s57-buisgl-outline",
      type: "line",
      source: sourceId,
      "source-layer": "BUISGL",
      paint: {
        "line-color": "#8c6d4f",
        "line-width": 0.5,
      },
    },
    // Unsurveyed areas — subtle gray
    {
      id: "s57-unsare",
      type: "fill",
      source: sourceId,
      "source-layer": "UNSARE",
      paint: {
        "fill-color": "#cccccc",
        "fill-opacity": 0.3,
      },
    },

    // ── Fill layers: regulatory overlays ────────────────────────────────
    // Fairways — very subtle outline only (shipping lanes)
    {
      id: "s57-fairwy",
      type: "fill",
      source: sourceId,
      "source-layer": "FAIRWY",
      paint: {
        "fill-color": "#ffffff",
        "fill-opacity": 0,
      },
    },
    {
      id: "s57-fairwy-outline",
      type: "line",
      source: sourceId,
      "source-layer": "FAIRWY",
      paint: {
        "line-color": "#7777aa",
        "line-width": 0.8,
        "line-dasharray": [6, 4],
      },
    },
    // Anchorage areas — outline only, purple dashed
    {
      id: "s57-achare",
      type: "line",
      source: sourceId,
      "source-layer": "ACHARE",
      paint: {
        "line-color": "#9933cc",
        "line-width": 1,
        "line-dasharray": [4, 3],
        "line-opacity": 0.6,
      },
    },
    // Traffic separation — outline only, magenta dashed
    {
      id: "s57-tsslpt",
      type: "line",
      source: sourceId,
      "source-layer": "TSSLPT",
      paint: {
        "line-color": "#cc33aa",
        "line-width": 1,
        "line-dasharray": [6, 3],
        "line-opacity": 0.6,
      },
    },
    // Restricted areas — outline only, orange dashed
    {
      id: "s57-resare",
      type: "line",
      source: sourceId,
      "source-layer": "RESARE",
      paint: {
        "line-color": "#dd6600",
        "line-width": 1,
        "line-dasharray": [4, 2],
        "line-opacity": 0.5,
      },
    },
    // Caution areas — outline only, yellow dashed
    {
      id: "s57-ctnare",
      type: "line",
      source: sourceId,
      "source-layer": "CTNARE",
      paint: {
        "line-color": "#ddaa00",
        "line-width": 1,
        "line-dasharray": [4, 2],
        "line-opacity": 0.5,
      },
    },

    // ── Line layers ─────────────────────────────────────────────────────
    // Depth contours
    {
      id: "s57-depcnt",
      type: "line",
      source: sourceId,
      "source-layer": "DEPCNT",
      paint: {
        "line-color": "#6a9fc0",
        "line-width": 0.7,
      },
    },
    // Coastline
    {
      id: "s57-coalne",
      type: "line",
      source: sourceId,
      "source-layer": "COALNE",
      paint: {
        "line-color": "#333333",
        "line-width": 1.5,
      },
    },
    // Shoreline construction (piers, wharves, seawalls)
    {
      id: "s57-slcons",
      type: "line",
      source: sourceId,
      "source-layer": "SLCONS",
      paint: {
        "line-color": "#555555",
        "line-width": 1,
      },
    },
    // Bridge structures
    {
      id: "s57-bridge",
      type: "line",
      source: sourceId,
      "source-layer": "BRIDGE",
      paint: {
        "line-color": "#664422",
        "line-width": 2,
      },
    },
    // Submarine cables — dashed gray
    {
      id: "s57-cblsub",
      type: "line",
      source: sourceId,
      "source-layer": "CBLSUB",
      paint: {
        "line-color": "#888888",
        "line-width": 1,
        "line-dasharray": [4, 3],
      },
    },
    // Overhead cables — dashed red/orange (clearance hazard)
    {
      id: "s57-cblohd",
      type: "line",
      source: sourceId,
      "source-layer": "CBLOHD",
      paint: {
        "line-color": "#cc4400",
        "line-width": 1.2,
        "line-dasharray": [5, 3],
      },
    },

    // ── Point / symbol layers ───────────────────────────────────────────
    // Soundings — circle + depth label
    {
      id: "s57-soundg-circle",
      type: "circle",
      source: sourceId,
      "source-layer": "SOUNDG",
      paint: {
        "circle-radius": 2,
        "circle-color": "#333333",
      },
    },
    {
      id: "s57-soundg-label",
      type: "symbol",
      source: sourceId,
      "source-layer": "SOUNDG",
      layout: {
        "text-field": ["to-string", ["get", "DEPTH"]],
        "text-size": 10,
        "text-offset": [0, 0.8],
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#333333",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1,
      },
    },
    // Lights — outer glow ring (renders below buoys)
    {
      id: "s57-lights",
      type: "circle",
      source: sourceId,
      "source-layer": "LIGHTS",
      paint: {
        "circle-radius": 12,
        "circle-color": "rgba(255, 220, 0, 0.25)",
        "circle-blur": 0.6,
        "circle-stroke-width": 2,
        "circle-stroke-color": "rgba(255, 180, 0, 0.5)",
      },
    },
    // Buoys (lateral) — IALA-B: CATLAM 1=port (green), 2=starboard (red)
    {
      id: "s57-boylat",
      type: "circle",
      source: sourceId,
      "source-layer": "BOYLAT",
      paint: {
        "circle-radius": 6,
        "circle-color": [
          "match",
          ["get", "CATLAM"],
          1,
          "#00aa00",
          2,
          "#cc0000",
          "#888888",
        ],
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#333333",
      },
    },
    // Safe water buoys — red/white (rendered as white with red stroke)
    {
      id: "s57-boysaw",
      type: "circle",
      source: sourceId,
      "source-layer": "BOYSAW",
      paint: {
        "circle-radius": 6,
        "circle-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#cc0000",
      },
    },
    // Special purpose buoys — yellow
    {
      id: "s57-boyspp",
      type: "circle",
      source: sourceId,
      "source-layer": "BOYSPP",
      paint: {
        "circle-radius": 5,
        "circle-color": "#ffdd00",
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#999900",
      },
    },
    // Isolated danger buoys — red/black (rendered as black with red stroke)
    {
      id: "s57-boyisd",
      type: "circle",
      source: sourceId,
      "source-layer": "BOYISD",
      paint: {
        "circle-radius": 6,
        "circle-color": "#222222",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#cc0000",
      },
    },
    // Lateral beacons — IALA-B: CATLAM 1=port (green), 2=starboard (red)
    {
      id: "s57-bcnlat",
      type: "circle",
      source: sourceId,
      "source-layer": "BCNLAT",
      paint: {
        "circle-radius": 5,
        "circle-color": [
          "match",
          ["get", "CATLAM"],
          1,
          "#00aa00",
          2,
          "#cc0000",
          "#888888",
        ],
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#333333",
      },
    },
    // ── Geographic labels ─────────────────────────────────────────────
    // Island / land area names (from LNDARE OBJNAM)
    {
      id: "s57-lndare-label",
      type: "symbol",
      source: sourceId,
      "source-layer": "LNDARE",
      filter: ["has", "OBJNAM"],
      layout: {
        "text-field": ["get", "OBJNAM"],
        "text-size": 13,
        "text-font": ["Open Sans Italic"],
        "text-allow-overlap": false,
        "text-padding": 10,
      },
      paint: {
        "text-color": "#5a4a32",
        "text-halo-color": "#f5e6c8",
        "text-halo-width": 1.5,
      },
    },
    // Berth / pier labels
    {
      id: "s57-berths-label",
      type: "symbol",
      source: sourceId,
      "source-layer": "BERTHS",
      filter: ["has", "OBJNAM"],
      layout: {
        "text-field": ["get", "OBJNAM"],
        "text-size": 10,
        "text-allow-overlap": false,
        "text-padding": 5,
      },
      paint: {
        "text-color": "#555555",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1,
      },
    },
    // Sea area names (tidal flats, bights, etc.)
    {
      id: "s57-seaare-label",
      type: "symbol",
      source: sourceId,
      "source-layer": "SEAARE",
      filter: ["has", "OBJNAM"],
      layout: {
        "text-field": ["get", "OBJNAM"],
        "text-size": 12,
        "text-font": ["Open Sans Italic"],
        "text-allow-overlap": false,
        "text-padding": 10,
      },
      paint: {
        "text-color": "#3a6a3a",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    },
    // ── Nav aid labels ──────────────────────────────────────────────────
    // Buoy number labels (from LABEL property added during pipeline)
    {
      id: "s57-boylat-label",
      type: "symbol",
      source: sourceId,
      "source-layer": "BOYLAT",
      layout: {
        "text-field": [
            "case",
            ["all", ["has", "LABEL"], ["!=", ["get", "LABEL"], ""]],
            ["concat", '"', ["get", "LABEL"], '"'],
            "",
          ],
        "text-size": 11,
        "text-offset": [0, 1.2],
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#333333",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    },
    // Beacon number labels
    {
      id: "s57-bcnlat-label",
      type: "symbol",
      source: sourceId,
      "source-layer": "BCNLAT",
      layout: {
        "text-field": [
            "case",
            ["all", ["has", "LABEL"], ["!=", ["get", "LABEL"], ""]],
            ["concat", '"', ["get", "LABEL"], '"'],
            "",
          ],
        "text-size": 11,
        "text-offset": [0, 1.2],
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#333333",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    },
    // Light characteristic labels (e.g. "Fl G 4s")
    {
      id: "s57-lights-label",
      type: "symbol",
      source: sourceId,
      "source-layer": "LIGHTS",
      layout: {
        "text-field": ["get", "LABEL"],
        "text-size": 10,
        "text-offset": [0, -1.5],
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#996600",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    },
    // Fog signals — small gray circle
    {
      id: "s57-fogsig",
      type: "circle",
      source: sourceId,
      "source-layer": "FOGSIG",
      paint: {
        "circle-radius": 4,
        "circle-color": "#999999",
        "circle-stroke-width": 1,
        "circle-stroke-color": "#666666",
      },
    },
    // Wrecks — ECDIS simplified: small circle with cross (⊗-like)
    {
      id: "s57-wrecks",
      type: "symbol",
      source: sourceId,
      "source-layer": "WRECKS",
      layout: {
        "text-field": "⊕",
        "text-size": 14,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#333333",
      },
    },
    // Obstructions — ECDIS simplified: ✕ (cross/saltire)
    {
      id: "s57-obstrn",
      type: "symbol",
      source: sourceId,
      "source-layer": "OBSTRN",
      layout: {
        "text-field": "✕",
        "text-size": 12,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#333333",
      },
    },
    // Underwater rocks — ECDIS simplified: + (plus sign)
    {
      id: "s57-uwtroc",
      type: "symbol",
      source: sourceId,
      "source-layer": "UWTROC",
      layout: {
        "text-field": "+",
        "text-size": 12,
        "text-allow-overlap": false,
        "text-font": ["Open Sans Bold"],
      },
      paint: {
        "text-color": "#333333",
      },
    },
    // Pilings — yellow-green circles (bridge remnants, dolphins, etc.)
    {
      id: "s57-pilpnt",
      type: "circle",
      source: sourceId,
      "source-layer": "PILPNT",
      paint: {
        "circle-radius": 5,
        "circle-color": "#c8cc66",
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#888833",
      },
    },
    // Mooring facilities — small gray circle
    {
      id: "s57-morfac",
      type: "circle",
      source: sourceId,
      "source-layer": "MORFAC",
      paint: {
        "circle-radius": 3,
        "circle-color": "#999999",
        "circle-stroke-width": 1,
        "circle-stroke-color": "#666666",
      },
    },
  ];
}
