import type { LayerSpecification } from "maplibre-gl";

/**
 * Minimal nautical chart style layers for S-57 vector tiles.
 * Simplified symbology — full S-52 symbology with sprites is deferred to Phase 1C.
 */
export function getNauticalLayers(sourceId: string): LayerSpecification[] {
  return [
    // Ocean background — visible where no DEPARE polygons exist
    {
      id: "s57-background",
      type: "background",
      paint: {
        "background-color": "#d4e8f7",
      },
    },
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
    // Buoys (lateral) — colored by COLOUR attribute
    {
      id: "s57-boylat",
      type: "circle",
      source: sourceId,
      "source-layer": "BOYLAT",
      paint: {
        "circle-radius": 6,
        "circle-color": [
          "match",
          ["coalesce", ["get", "COLOUR"], ""],
          "1",
          "#ffffff",
          "2",
          "#000000",
          "3",
          "#ff0000",
          "4",
          "#00ff00",
          "5",
          "#0000ff",
          "6",
          "#ffff00",
          "#888888",
        ],
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#333333",
      },
    },
    // Lights — yellow glow
    {
      id: "s57-lights",
      type: "circle",
      source: sourceId,
      "source-layer": "LIGHTS",
      paint: {
        "circle-radius": 5,
        "circle-color": "#ffdd00",
        "circle-opacity": 0.8,
        "circle-blur": 0.5,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#cc9900",
      },
    },
    // Wrecks — dark purple circle
    {
      id: "s57-wrecks",
      type: "circle",
      source: sourceId,
      "source-layer": "WRECKS",
      paint: {
        "circle-radius": 5,
        "circle-color": "#663399",
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#333333",
      },
    },
    // Obstructions — dark circle
    {
      id: "s57-obstrn",
      type: "circle",
      source: sourceId,
      "source-layer": "OBSTRN",
      paint: {
        "circle-radius": 4,
        "circle-color": "#333333",
        "circle-stroke-width": 1,
        "circle-stroke-color": "#000000",
      },
    },
  ];
}
