/**
 * Navigation plotting layer: bearing lines, segment lines, symbols, and text.
 * Uses GeoJSON sources + MapLibre layers, with DraggablePoints for interaction.
 */

import type maplibregl from "maplibre-gl";
import { getPlottingSheet, savePlottingSheet } from "../../data/db";
import { getSettings, onSettingsChange } from "../../settings";
import {
  haversineDistanceNM,
  initialBearingDeg,
  projectPoint,
} from "../../utils/coordinates";
import { formatBearing } from "../../utils/magnetic";
import { generateUUID } from "../../utils/uuid";
import { DraggablePoints } from "../DraggablePoints";
import { getMode, onModeChange, setMode } from "../InteractionMode";
import { createBearingInput, parseBearingInput } from "./bearingInput";
import { type PlotTool, PlotToolbar } from "./PlotToolbar";
import type {
  PlotBearingLine,
  PlotSegmentLine,
  PlotSymbol,
  PlotText,
  PlottingSheet,
} from "./PlottingTypes";
import {
  ensurePlotIcons,
  PLOT_SHAPE_ICON_EXPR,
  type PlotSymbolShape,
} from "./plot-icons";

const SOURCE_LINES = "_plot-lines";
const SOURCE_POINTS = "_plot-points";
const SOURCE_LABELS = "_plot-labels";
const SOURCE_SYMBOLS = "_plot-symbols";
const SOURCE_LINE_LABELS = "_plot-line-labels";
const LAYER_LINES = "_plot-lines";
const LAYER_POINTS = "_plot-points";
const LAYER_LABELS = "_plot-labels";
const LAYER_SYMBOLS = "_plot-symbols";
const LAYER_SYM_LABELS = "_plot-sym-labels";
const LAYER_LINE_LABELS = "_plot-line-labels";

/** How far (NM) bearing lines extend each direction from anchor. */
const BEARING_LINE_EXTENT = 30;

const DEFAULT_SHEET_ID = "default";

/** Maps a sequential point index → element id + which endpoint. */
interface PointLookup {
  elementId: string;
  pointIndex: number; // 0 for single-point elements; 0 or 1 for segment endpoints
}

export class PlottingLayer {
  private readonly map: maplibregl.Map;
  private sheet: PlottingSheet;
  private toolbar: PlotToolbar;
  private draggable: DraggablePoints | null = null;
  private selectedId: string | null = null;

  /** Lookup table rebuilt on every updateSources — maps sequential index to element. */
  private pointLookup: PointLookup[] = [];

  /** Active symbol shape for placement. */
  private activeSymbolShape: PlotSymbolShape = "circle";

  /** Segment line drawing state: start point + live preview end. */
  private segmentStart: { lat: number; lon: number } | null = null;
  private segmentPreviewEnd: { lat: number; lon: number } | null = null;
  private segmentDrawing = false;

  private clickHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private segmentMouseDownHandler:
    | ((e: maplibregl.MapMouseEvent) => void)
    | null = null;
  private segmentMouseMoveHandler:
    | ((e: maplibregl.MapMouseEvent) => void)
    | null = null;
  private segmentMouseUpHandler:
    | ((e: maplibregl.MapMouseEvent) => void)
    | null = null;
  private segmentTouchStart: ((e: TouchEvent) => void) | null = null;
  private segmentTouchMove: ((e: TouchEvent) => void) | null = null;
  private segmentTouchEnd: ((e: TouchEvent) => void) | null = null;

  /** Bearing/text input popup element, if open. */
  private popupInputEl: HTMLDivElement | null = null;

  /** Bound keyboard handler for Delete key (assigned in constructor). */
  private readonly keyHandler!: (e: KeyboardEvent) => void;

  constructor(map: maplibregl.Map) {
    this.map = map;
    this.sheet = {
      id: DEFAULT_SHEET_ID,
      name: "Default",
      createdAt: Date.now(),
      elements: [],
    };

    this.toolbar = new PlotToolbar({
      onToolSelect: (tool) => this.onToolSelect(tool),
      onSymbolShapeSelect: (shape) => {
        this.activeSymbolShape = shape;
      },
      onDelete: () => this.deleteSelected(),
      onClear: () => this.clearAll(),
      onDone: () => this.exitPlotMode(),
      onEditElement: (id, changes) => this.applyEdit(id, changes),
    });

    // Set up layers on style load; re-populate sources after reload
    map.on("style.load", () => {
      this.setupLayers();
      this.updateSources();
    });
    if (map.isStyleLoaded()) this.setupLayers();

    // React to mode changes
    onModeChange((mode) => {
      if (mode === "plot") {
        this.enterPlotMode();
      } else {
        this.toolbar.hide();
        this.cleanupInteraction();
      }
    });

    // Delete/Backspace to delete selected element
    this.keyHandler = (e: KeyboardEvent) => {
      if (getMode() !== "plot") return;
      if (!this.selectedId) return;
      // Don't intercept if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        this.deleteSelected();
      }
    };
    document.addEventListener("keydown", this.keyHandler);

    // Re-render labels when bearing mode changes (true ↔ magnetic)
    let prevBearingMode = getSettings().bearingMode;
    onSettingsChange((s) => {
      if (s.bearingMode !== prevBearingMode) {
        prevBearingMode = s.bearingMode;
        this.updateSources();
      }
    });

    // Load persisted sheet
    this.loadSheet();
  }

  // --- Public API (called from context menu / external code) ---

  /** Show bearing input at the given chart position. Enters plot mode. */
  promptBearing(lat: number, lon: number): void {
    setMode("plot");
    this.toolbar.setTool("none");
    this.showBearingInput(lat, lon);
  }

  /** Enter plot mode (e.g. from toolbar button). */
  enterPlotMode(): void {
    if (getMode() !== "plot") setMode("plot");
    this.toolbar.show();
    this.toolbar.setStatus("");
    this.updateSources();
    this.setupDrag();
    this.installClickHandler();
  }

  /** Place a symbol at the given position (e.g. from context menu). Enters plot mode. */
  placeSymbolAt(lat: number, lon: number): void {
    setMode("plot");
    this.placeSymbol(lat, lon);
  }

  /** Start a segment line from a specific point (e.g. context menu).
   *  Sets the start point; the next mousedown-drag sets the endpoint. */
  startSegmentFrom(lat: number, lon: number): void {
    setMode("plot");
    this.toolbar.setTool("segment");
    this.segmentStart = { lat, lon };
    this.toolbar.setStatus("Drag to set endpoint");
    this.updateSources();
  }

  // --- Persistence ---

  private async loadSheet(): Promise<void> {
    const stored = await getPlottingSheet(DEFAULT_SHEET_ID);
    if (stored) {
      this.sheet = stored;
      this.updateSources();
    }
  }

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private save(): void {
    savePlottingSheet(this.sheet).catch(console.error);
  }

  /** Debounced save — batches rapid updates (e.g. during drag). */
  private saveSoon(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 300);
  }

  // --- Layer setup ---

  private setupLayers(): void {
    if (this.map.getSource(SOURCE_LINES)) return;

    const empty: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [],
    };

    this.map.addSource(SOURCE_LINES, { type: "geojson", data: empty });
    this.map.addSource(SOURCE_POINTS, { type: "geojson", data: empty });
    this.map.addSource(SOURCE_LABELS, { type: "geojson", data: empty });
    this.map.addSource(SOURCE_SYMBOLS, { type: "geojson", data: empty });
    this.map.addSource(SOURCE_LINE_LABELS, { type: "geojson", data: empty });

    this.map.addLayer({
      id: LAYER_LINES,
      type: "line",
      source: SOURCE_LINES,
      paint: {
        "line-color": "#222",
        "line-width": 1.5,
      },
    });

    // Bearing/segment labels along lines
    this.map.addLayer({
      id: LAYER_LINE_LABELS,
      type: "symbol",
      source: SOURCE_LINE_LABELS,
      layout: {
        "symbol-placement": "line-center",
        "text-field": ["get", "label"],
        "text-size": 11,
        "text-offset": [0, -0.8],
        "text-allow-overlap": true,
        "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
      },
      paint: {
        "text-color": "#222",
        "text-halo-color": "#fff",
        "text-halo-width": 1.5,
      },
    });

    // Point labels (text annotations, positioned above point)
    this.map.addLayer({
      id: LAYER_LABELS,
      type: "symbol",
      source: SOURCE_LABELS,
      layout: {
        "text-field": ["get", "label"],
        "text-size": 12,
        "text-offset": [0, -1.2],
        "text-allow-overlap": true,
        "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
      },
      paint: {
        "text-color": "#222",
        "text-halo-color": "#fff",
        "text-halo-width": 1.5,
      },
    });

    // Symbol layer (nav symbols: DR, fix, EP, running fix)
    ensurePlotIcons(this.map);
    this.map.addLayer({
      id: LAYER_SYMBOLS,
      type: "symbol",
      source: SOURCE_SYMBOLS,
      layout: {
        "icon-image": PLOT_SHAPE_ICON_EXPR,
        "icon-size": 1,
        "icon-allow-overlap": true,
      },
    });

    // Symbol labels (below the symbol)
    this.map.addLayer({
      id: LAYER_SYM_LABELS,
      type: "symbol",
      source: SOURCE_SYMBOLS,
      layout: {
        "text-field": ["get", "label"],
        "text-size": 11,
        "text-offset": [0, 1.4],
        "text-allow-overlap": true,
        "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
      },
      paint: {
        "text-color": "#222",
        "text-halo-color": "#fff",
        "text-halo-width": 1.5,
      },
    });

    // Drag handle points (on top of everything)
    this.map.addLayer({
      id: LAYER_POINTS,
      type: "circle",
      source: SOURCE_POINTS,
      paint: {
        "circle-radius": ["case", ["==", ["get", "mode"], "plot"], 6, 4],
        "circle-color": [
          "case",
          ["==", ["get", "selected"], true],
          "#4488cc",
          "#333",
        ],
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 2,
        "circle-opacity": ["case", ["==", ["get", "mode"], "plot"], 1, 0.6],
      },
    });
  }

  // --- Source updates ---

  private updateSources(): void {
    const lineSrc = this.map.getSource(SOURCE_LINES) as
      | maplibregl.GeoJSONSource
      | undefined;
    const ptSrc = this.map.getSource(SOURCE_POINTS) as
      | maplibregl.GeoJSONSource
      | undefined;
    const lblSrc = this.map.getSource(SOURCE_LABELS) as
      | maplibregl.GeoJSONSource
      | undefined;
    const symSrc = this.map.getSource(SOURCE_SYMBOLS) as
      | maplibregl.GeoJSONSource
      | undefined;
    const lineLblSrc = this.map.getSource(SOURCE_LINE_LABELS) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!lineSrc || !ptSrc || !lblSrc || !symSrc || !lineLblSrc) return;

    const inPlotMode = getMode() === "plot";
    const lines: GeoJSON.Feature[] = [];
    const points: GeoJSON.Feature[] = [];
    const labels: GeoJSON.Feature[] = []; // text annotations (point-placed)
    const lineLabels: GeoJSON.Feature[] = []; // bearing/segment labels (line-placed)
    const symbols: GeoJSON.Feature[] = [];
    const lookup: PointLookup[] = [];
    let ptIdx = 0;

    for (const el of this.sheet.elements) {
      const isSelected = el.id === this.selectedId;

      if (el.type === "bearing-line") {
        const fwd = projectPoint(
          el.lat,
          el.lon,
          el.bearingTrue,
          BEARING_LINE_EXTENT,
        );
        const rev = projectPoint(
          el.lat,
          el.lon,
          (el.bearingTrue + 180) % 360,
          BEARING_LINE_EXTENT,
        );

        lines.push({
          type: "Feature",
          properties: { id: el.id },
          geometry: {
            type: "LineString",
            coordinates: [rev, [el.lon, el.lat], fwd],
          },
        });

        lookup.push({ elementId: el.id, pointIndex: 0 });
        points.push({
          type: "Feature",
          properties: {
            id: el.id,
            index: ptIdx++,
            mode: inPlotMode ? "plot" : "view",
            selected: isSelected,
          },
          geometry: { type: "Point", coordinates: [el.lon, el.lat] },
        });

        if (el.label) {
          // Place bearing label along the line
          lineLabels.push({
            type: "Feature",
            properties: { id: el.id, label: el.label },
            geometry: {
              type: "LineString",
              coordinates: [rev, [el.lon, el.lat], fwd],
            },
          });
        }
      } else if (el.type === "segment-line") {
        lines.push({
          type: "Feature",
          properties: { id: el.id },
          geometry: {
            type: "LineString",
            coordinates: [
              [el.lon1, el.lat1],
              [el.lon2, el.lat2],
            ],
          },
        });

        lookup.push({ elementId: el.id, pointIndex: 0 });
        points.push({
          type: "Feature",
          properties: {
            id: el.id,
            index: ptIdx++,
            mode: inPlotMode ? "plot" : "view",
            selected: isSelected,
          },
          geometry: { type: "Point", coordinates: [el.lon1, el.lat1] },
        });

        lookup.push({ elementId: el.id, pointIndex: 1 });
        points.push({
          type: "Feature",
          properties: {
            id: el.id,
            index: ptIdx++,
            mode: inPlotMode ? "plot" : "view",
            selected: isSelected,
          },
          geometry: { type: "Point", coordinates: [el.lon2, el.lat2] },
        });

        // Label with distance/bearing
        const dist = haversineDistanceNM(el.lat1, el.lon1, el.lat2, el.lon2);
        const brg = initialBearingDeg(el.lat1, el.lon1, el.lat2, el.lon2);
        const { bearingMode, depthUnit } = getSettings();
        const fmtBrg = formatBearing(brg, bearingMode, el.lat1, el.lon1);
        let distStr: string;
        if (dist < 0.1) {
          if (depthUnit === "feet" || depthUnit === "fathoms") {
            distStr = `${Math.round(dist * 6076.12)} ft`;
          } else {
            distStr = `${Math.round(dist * 1852)} m`;
          }
        } else {
          distStr = `${dist.toFixed(2)} NM`;
        }
        const segLabel = el.label
          ? `${el.label} — ${distStr} ${fmtBrg}`
          : `${distStr} ${fmtBrg}`;

        // Place segment label along the line
        lineLabels.push({
          type: "Feature",
          properties: { id: el.id, label: segLabel },
          geometry: {
            type: "LineString",
            coordinates: [
              [el.lon1, el.lat1],
              [el.lon2, el.lat2],
            ],
          },
        });
      } else if (el.type === "symbol") {
        symbols.push({
          type: "Feature",
          properties: { id: el.id, shape: el.shape, label: el.label },
          geometry: { type: "Point", coordinates: [el.lon, el.lat] },
        });

        lookup.push({ elementId: el.id, pointIndex: 0 });
        points.push({
          type: "Feature",
          properties: {
            id: el.id,
            index: ptIdx++,
            mode: inPlotMode ? "plot" : "view",
            selected: isSelected,
          },
          geometry: { type: "Point", coordinates: [el.lon, el.lat] },
        });
      } else if (el.type === "text") {
        labels.push({
          type: "Feature",
          properties: { id: el.id, label: el.text },
          geometry: { type: "Point", coordinates: [el.lon, el.lat] },
        });

        lookup.push({ elementId: el.id, pointIndex: 0 });
        points.push({
          type: "Feature",
          properties: {
            id: el.id,
            index: ptIdx++,
            mode: inPlotMode ? "plot" : "view",
            selected: isSelected,
          },
          geometry: { type: "Point", coordinates: [el.lon, el.lat] },
        });
      }
    }

    // Show in-progress segment line (drag preview)
    if (this.segmentStart && inPlotMode) {
      lookup.push({ elementId: "__pending", pointIndex: 0 });
      points.push({
        type: "Feature",
        properties: {
          id: "__pending",
          index: ptIdx++,
          mode: "plot",
          selected: false,
        },
        geometry: {
          type: "Point",
          coordinates: [this.segmentStart.lon, this.segmentStart.lat],
        },
      });

      if (this.segmentPreviewEnd) {
        lines.push({
          type: "Feature",
          properties: { id: "__pending" },
          geometry: {
            type: "LineString",
            coordinates: [
              [this.segmentStart.lon, this.segmentStart.lat],
              [this.segmentPreviewEnd.lon, this.segmentPreviewEnd.lat],
            ],
          },
        });
      }
    }

    this.pointLookup = lookup;

    lineSrc.setData({ type: "FeatureCollection", features: lines });
    ptSrc.setData({ type: "FeatureCollection", features: points });
    lblSrc.setData({ type: "FeatureCollection", features: labels });
    symSrc.setData({ type: "FeatureCollection", features: symbols });
    lineLblSrc.setData({ type: "FeatureCollection", features: lineLabels });
  }

  // --- Interaction ---

  private installClickHandler(): void {
    this.removeClickHandler();
    // Also install segment drag-to-draw if segment tool is active
    if (this.toolbar.getTool() === "segment") {
      this.installSegmentDraw();
    }

    this.clickHandler = (e: maplibregl.MapMouseEvent) => {
      if (getMode() !== "plot") return;
      const tool = this.toolbar.getTool();

      // Check if clicking on an existing element to select it
      // Check points first, then lines and symbols
      if (tool === "none") {
        const hitLayers = [
          LAYER_POINTS,
          LAYER_LINES,
          LAYER_SYMBOLS,
          LAYER_LABELS,
          LAYER_LINE_LABELS,
          LAYER_SYM_LABELS,
        ].filter((id) => this.map.getLayer(id));
        const features = this.map.queryRenderedFeatures(e.point, {
          layers: hitLayers,
        });
        if (features.length > 0) {
          const id = features[0].properties?.id as string;
          if (id && id !== "__pending") {
            this.selectElement(id);
            return;
          }
        }
        this.selectElement(null);
        return;
      }

      const { lat, lng: lon } = e.lngLat;

      if (tool === "bearing") {
        this.showBearingInput(lat, lon);
      } else if (tool === "symbol") {
        this.placeSymbol(lat, lon);
      } else if (tool === "text") {
        this.showTextInput(lat, lon);
      }
    };
    this.map.on("click", this.clickHandler);
  }

  private removeClickHandler(): void {
    if (this.clickHandler) {
      this.map.off("click", this.clickHandler);
      this.clickHandler = null;
    }
  }

  /** Install mousedown/mousemove/mouseup for drag-to-draw segment lines. */
  private installSegmentDraw(): void {
    this.removeSegmentDraw();

    this.segmentMouseDownHandler = (e: maplibregl.MapMouseEvent) => {
      if (getMode() !== "plot") return;
      if (this.toolbar.getTool() !== "segment") return;

      // Don't start drawing if clicking on an existing drag handle
      const hits = this.map.queryRenderedFeatures(e.point, {
        layers: [LAYER_POINTS],
      });
      if (hits.length > 0 && hits[0].properties?.id !== "__pending") return;

      e.preventDefault();
      const { lat, lng: lon } = e.lngLat;

      // If start already set (e.g. from context menu), keep it;
      // otherwise set from this mousedown position.
      if (!this.segmentStart) {
        this.segmentStart = { lat, lon };
      }
      this.segmentPreviewEnd = { lat, lon };
      this.segmentDrawing = true;
      this.map.dragPan.disable();
      this.toolbar.setStatus("Release to place endpoint");
      this.updateSources();
    };

    this.segmentMouseMoveHandler = (e: maplibregl.MapMouseEvent) => {
      if (!this.segmentDrawing) return;
      this.segmentPreviewEnd = { lat: e.lngLat.lat, lon: e.lngLat.lng };
      this.updateSources();
    };

    this.segmentMouseUpHandler = (e: maplibregl.MapMouseEvent) => {
      if (!this.segmentDrawing || !this.segmentStart) return;
      this.segmentDrawing = false;
      this.map.dragPan.enable();

      const { lat, lng: lon } = e.lngLat;

      // Only commit if dragged a meaningful distance (> ~5px)
      const startPx = this.map.project([
        this.segmentStart.lon,
        this.segmentStart.lat,
      ]);
      const endPx = e.point;
      const dx = endPx.x - startPx.x;
      const dy = endPx.y - startPx.y;
      if (dx * dx + dy * dy < 25) {
        // Too short — cancel
        this.segmentStart = null;
        this.segmentPreviewEnd = null;
        this.resetToSelectMode();
        this.updateSources();
        return;
      }

      const seg: PlotSegmentLine = {
        id: generateUUID(),
        type: "segment-line",
        lat1: this.segmentStart.lat,
        lon1: this.segmentStart.lon,
        lat2: lat,
        lon2: lon,
        label: "",
        createdAt: Date.now(),
      };
      this.sheet.elements.push(seg);
      this.segmentStart = null;
      this.segmentPreviewEnd = null;
      this.save();
      this.resetToSelectMode(seg.id);
      this.updateSources();
      this.setupDrag();
    };

    this.map.on("mousedown", this.segmentMouseDownHandler);
    this.map.on("mousemove", this.segmentMouseMoveHandler);
    this.map.on("mouseup", this.segmentMouseUpHandler);

    // Touch support for mobile
    const canvas = this.map.getCanvas();

    this.segmentTouchStart = (e: TouchEvent) => {
      if (getMode() !== "plot") return;
      if (this.toolbar.getTool() !== "segment") return;
      if (e.touches.length !== 1) return;

      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      const point: [number, number] = [
        touch.clientX - rect.left,
        touch.clientY - rect.top,
      ];

      // Don't start if on an existing drag handle
      const hits = this.map.queryRenderedFeatures(point, {
        layers: [LAYER_POINTS],
      });
      if (hits.length > 0 && hits[0].properties?.id !== "__pending") return;

      e.preventDefault();
      const lngLat = this.map.unproject(point);
      if (!this.segmentStart) {
        this.segmentStart = { lat: lngLat.lat, lon: lngLat.lng };
      }
      this.segmentPreviewEnd = { lat: lngLat.lat, lon: lngLat.lng };
      this.segmentDrawing = true;
      this.map.dragPan.disable();
      this.toolbar.setStatus("Release to place endpoint");
      this.updateSources();
    };

    this.segmentTouchMove = (e: TouchEvent) => {
      if (!this.segmentDrawing || e.touches.length !== 1) return;
      e.preventDefault();
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      const lngLat = this.map.unproject([
        touch.clientX - rect.left,
        touch.clientY - rect.top,
      ]);
      this.segmentPreviewEnd = { lat: lngLat.lat, lon: lngLat.lng };
      this.updateSources();
    };

    this.segmentTouchEnd = (_e: TouchEvent) => {
      if (!this.segmentDrawing || !this.segmentStart) return;
      this.segmentDrawing = false;
      this.map.dragPan.enable();

      const end = this.segmentPreviewEnd;
      if (!end) {
        this.segmentStart = null;
        this.segmentPreviewEnd = null;
        this.updateSources();
        return;
      }

      // Check minimum distance
      const startPx = this.map.project([
        this.segmentStart.lon,
        this.segmentStart.lat,
      ]);
      const endPx = this.map.project([end.lon, end.lat]);
      const dx = endPx.x - startPx.x;
      const dy = endPx.y - startPx.y;
      if (dx * dx + dy * dy < 25) {
        this.segmentStart = null;
        this.segmentPreviewEnd = null;
        this.resetToSelectMode();
        this.updateSources();
        return;
      }

      const seg: PlotSegmentLine = {
        id: generateUUID(),
        type: "segment-line",
        lat1: this.segmentStart.lat,
        lon1: this.segmentStart.lon,
        lat2: end.lat,
        lon2: end.lon,
        label: "",
        createdAt: Date.now(),
      };
      this.sheet.elements.push(seg);
      this.segmentStart = null;
      this.segmentPreviewEnd = null;
      this.save();
      this.resetToSelectMode(seg.id);
      this.updateSources();
      this.setupDrag();
    };

    canvas.addEventListener("touchstart", this.segmentTouchStart, {
      passive: false,
    });
    canvas.addEventListener("touchmove", this.segmentTouchMove, {
      passive: false,
    });
    canvas.addEventListener("touchend", this.segmentTouchEnd);
  }

  private removeSegmentDraw(): void {
    if (this.segmentMouseDownHandler) {
      this.map.off("mousedown", this.segmentMouseDownHandler);
      this.segmentMouseDownHandler = null;
    }
    if (this.segmentMouseMoveHandler) {
      this.map.off("mousemove", this.segmentMouseMoveHandler);
      this.segmentMouseMoveHandler = null;
    }
    if (this.segmentMouseUpHandler) {
      this.map.off("mouseup", this.segmentMouseUpHandler);
      this.segmentMouseUpHandler = null;
    }
    const canvas = this.map.getCanvas();
    if (this.segmentTouchStart) {
      canvas.removeEventListener("touchstart", this.segmentTouchStart);
      this.segmentTouchStart = null;
    }
    if (this.segmentTouchMove) {
      canvas.removeEventListener("touchmove", this.segmentTouchMove);
      this.segmentTouchMove = null;
    }
    if (this.segmentTouchEnd) {
      canvas.removeEventListener("touchend", this.segmentTouchEnd);
      this.segmentTouchEnd = null;
    }
    this.segmentDrawing = false;
    this.segmentPreviewEnd = null;
  }

  /** Reset to select/edit mode after a one-shot tool placement.
   *  Optionally auto-selects the just-placed element. */
  private resetToSelectMode(selectId?: string): void {
    this.toolbar.setTool("none");
    this.toolbar.setStatus("");
    this.removeSegmentDraw();
    this.removePopupInput();
    if (selectId) {
      this.selectedId = selectId;
      this.toolbar.setDeleteVisible(true);
      const el = this.sheet.elements.find((e) => e.id === selectId);
      if (el) this.toolbar.showEditControls(el);
    }
  }

  private placeSymbol(lat: number, lon: number): void {
    const sym: PlotSymbol = {
      id: generateUUID(),
      type: "symbol",
      lat,
      lon,
      shape: this.activeSymbolShape,
      label: "",
      createdAt: Date.now(),
    };
    this.sheet.elements.push(sym);
    this.save();
    this.resetToSelectMode(sym.id);
    this.updateSources();
    this.setupDrag();
  }

  private showBearingInput(lat: number, lon: number): void {
    this.removePopupInput();

    this.popupInputEl = createBearingInput(
      (value) => {
        const { bearingMode } = getSettings();
        const parsed = parseBearingInput(value, bearingMode, lat, lon);
        if (!parsed) return; // invalid input, keep input open
        const el: PlotBearingLine = {
          id: generateUUID(),
          type: "bearing-line",
          lat,
          lon,
          bearingTrue: parsed.trueBearing,
          label: parsed.label,
          createdAt: Date.now(),
        };
        this.sheet.elements.push(el);
        this.save();
        this.resetToSelectMode(el.id);
        this.updateSources();
        this.setupDrag();
      },
      () => this.removePopupInput(),
    );

    this.toolbar.element.after(this.popupInputEl);
  }

  private showTextInput(lat: number, lon: number): void {
    this.removePopupInput();

    this.popupInputEl = this.createTextInputPopup(
      (text) => {
        const el: PlotText = {
          id: generateUUID(),
          type: "text",
          lat,
          lon,
          text,
          createdAt: Date.now(),
        };
        this.sheet.elements.push(el);
        this.save();
        this.resetToSelectMode(el.id);
        this.updateSources();
        this.setupDrag();
      },
      () => this.removePopupInput(),
    );

    this.toolbar.element.after(this.popupInputEl);
  }

  private createTextInputPopup(
    onSubmit: (value: string) => void,
    onCancel: () => void,
  ): HTMLDivElement {
    const container = document.createElement("div");
    container.className = "plot-bearing-input"; // reuse same styling

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Text annotation";
    input.className = "plot-bearing-field";

    const okBtn = document.createElement("button");
    okBtn.className = "plot-toolbar-btn";
    okBtn.textContent = "OK";

    container.append(input, okBtn);

    const submit = () => {
      const val = input.value.trim();
      if (val) onSubmit(val);
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
      e.stopPropagation();
    });

    okBtn.addEventListener("click", submit);
    requestAnimationFrame(() => input.focus());

    return container;
  }

  private removePopupInput(): void {
    if (this.popupInputEl) {
      this.popupInputEl.remove();
      this.popupInputEl = null;
    }
  }

  private selectElement(id: string | null): void {
    this.selectedId = id;
    this.toolbar.setDeleteVisible(id !== null);

    if (id) {
      const el = this.sheet.elements.find((e) => e.id === id);
      if (el) {
        this.toolbar.showEditControls(el);
      }
    } else {
      this.toolbar.hideEditArea();
    }

    this.updateSources();
  }

  /** Apply inline edits from the toolbar to an element. */
  private applyEdit(id: string, changes: Record<string, string>): void {
    const el = this.sheet.elements.find((e) => e.id === id);
    if (!el) return;

    if (el.type === "bearing-line" && changes.bearing !== undefined) {
      // Re-parse the bearing string
      const { bearingMode } = getSettings();
      const parsed = parseBearingInput(
        changes.bearing,
        bearingMode,
        el.lat,
        el.lon,
      );
      if (parsed) {
        el.bearingTrue = parsed.trueBearing;
        el.label = parsed.label;
      }
      // Invalid bearing input is silently ignored — line keeps its current angle
    } else if (el.type === "segment-line" && changes.label !== undefined) {
      el.label = changes.label;
    } else if (el.type === "symbol" && changes.label !== undefined) {
      el.label = changes.label;
    } else if (el.type === "text" && changes.text !== undefined) {
      el.text = changes.text;
    }

    this.save();
    this.updateSources();
  }

  private deleteSelected(): void {
    if (!this.selectedId) return;
    this.sheet.elements = this.sheet.elements.filter(
      (el) => el.id !== this.selectedId,
    );
    this.selectedId = null;
    this.toolbar.setDeleteVisible(false);
    this.toolbar.hideEditArea();
    this.save();
    this.updateSources();
    this.setupDrag();
  }

  private clearAll(): void {
    if (this.sheet.elements.length === 0) return;
    this.sheet.elements = [];
    this.selectedId = null;
    this.toolbar.setDeleteVisible(false);
    this.toolbar.hideEditArea();
    this.segmentStart = null;
    this.toolbar.setStatus("");
    this.save();
    this.updateSources();
    this.setupDrag();
  }

  private onToolSelect(tool: PlotTool): void {
    this.segmentStart = null;
    this.segmentPreviewEnd = null;
    this.removePopupInput();
    this.removeSegmentDraw();
    this.selectElement(null);
    if (tool === "segment") {
      this.toolbar.setStatus("Drag to draw a line");
      this.installSegmentDraw();
    } else if (tool === "bearing") {
      this.toolbar.setStatus("Click to place bearing line");
    } else if (tool === "symbol") {
      this.toolbar.setStatus("Click to place symbol");
    } else if (tool === "text") {
      this.toolbar.setStatus("Click to place text");
    } else {
      this.toolbar.setStatus("");
    }
    this.updateSources();
  }

  private exitPlotMode(): void {
    this.toolbar.hide();
    this.toolbar.setTool("none");
    this.segmentStart = null;
    this.segmentPreviewEnd = null;
    this.removePopupInput();
    this.removeSegmentDraw();
    this.selectElement(null);
    this.cleanupInteraction();
    setMode("query");
    this.updateSources();
  }

  private setupDrag(): void {
    if (this.draggable) {
      this.draggable.destroy();
      this.draggable = null;
    }
    if (getMode() !== "plot") return;

    this.draggable = new DraggablePoints(
      this.map,
      LAYER_POINTS,
      (featureIndex, lngLat) => {
        // featureIndex is the "index" property captured at mousedown —
        // use our lookup table to resolve which element/endpoint to move.
        const entry = this.pointLookup[featureIndex];
        if (!entry || entry.elementId === "__pending") return;

        const el = this.sheet.elements.find((e) => e.id === entry.elementId);
        if (!el) return;

        if (el.type === "bearing-line") {
          el.lat = lngLat.lat;
          el.lon = lngLat.lng;
        } else if (el.type === "segment-line") {
          if (entry.pointIndex === 0) {
            el.lat1 = lngLat.lat;
            el.lon1 = lngLat.lng;
          } else {
            el.lat2 = lngLat.lat;
            el.lon2 = lngLat.lng;
          }
        } else if (el.type === "symbol" || el.type === "text") {
          el.lat = lngLat.lat;
          el.lon = lngLat.lng;
        }

        this.updateSources();
        this.saveSoon();
      },
    );
  }

  private cleanupInteraction(): void {
    this.removeClickHandler();
    this.removePopupInput();
    this.removeSegmentDraw();
    if (this.draggable) {
      this.draggable.destroy();
      this.draggable = null;
    }
  }
}
