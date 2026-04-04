/**
 * Canvas-drawn navigation plotting symbols.
 * Standard chart symbols:
 *   - half-circle: Dead Reckoning (DR) position
 *   - circle: Fix (visual/radar)
 *   - square: Estimated Position (EP)
 *   - triangle: Running fix
 *
 * Call ensurePlotIcons(map) once per style load.
 */

import type maplibregl from "maplibre-gl";

const SIZE = 24;

export type PlotSymbolShape = "half-circle" | "circle" | "square" | "triangle";

export const PLOT_SHAPES: PlotSymbolShape[] = [
  "half-circle",
  "circle",
  "square",
  "triangle",
];

/** Shape labels for UI display. */
export const SHAPE_LABELS: Record<PlotSymbolShape, string> = {
  "half-circle": "DR",
  circle: "Fix",
  square: "EP",
  triangle: "R.Fix",
};

const ICON_PREFIX = "_plot-sym-";

/** Icon name for a given shape. */
export function plotIconName(shape: PlotSymbolShape): string {
  return `${ICON_PREFIX}${shape}`;
}

/** MapLibre expression mapping shape property to icon name. */
export const PLOT_SHAPE_ICON_EXPR: maplibregl.ExpressionSpecification = [
  "concat",
  ICON_PREFIX,
  ["get", "shape"],
];

/** Register all plot symbol icons. Safe to call multiple times. */
export function ensurePlotIcons(map: maplibregl.Map): void {
  if (map.hasImage(plotIconName("circle"))) return;

  addPlotIcon(map, "half-circle", drawHalfCircle);
  addPlotIcon(map, "circle", drawCircle);
  addPlotIcon(map, "square", drawSquare);
  addPlotIcon(map, "triangle", drawTriangle);
}

function addPlotIcon(
  map: maplibregl.Map,
  shape: PlotSymbolShape,
  draw: (ctx: CanvasRenderingContext2D) => void,
): void {
  const ratio = window.devicePixelRatio || 1;
  const px = Math.round(SIZE * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(ratio, ratio);
  draw(ctx);
  if (map.hasImage(plotIconName(shape))) map.removeImage(plotIconName(shape));
  map.addImage(
    plotIconName(shape),
    { width: px, height: px, data: ctx.getImageData(0, 0, px, px).data },
    { pixelRatio: ratio },
  );
}

// --- Drawing functions ---

const STROKE = "#000";
const LINE_W = 2;
const cx = SIZE / 2;

/** Half-circle (open bottom) — Dead Reckoning position. */
function drawHalfCircle(ctx: CanvasRenderingContext2D): void {
  const r = cx - 2;
  ctx.beginPath();
  ctx.arc(cx, cx, r, Math.PI, 0); // top half only
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = LINE_W;
  ctx.stroke();

  // Small cross at center
  const s = 3;
  ctx.beginPath();
  ctx.moveTo(cx - s, cx);
  ctx.lineTo(cx + s, cx);
  ctx.moveTo(cx, cx - s);
  ctx.lineTo(cx, cx + s);
  ctx.stroke();
}

/** Full circle — Fix (visual/radar). */
function drawCircle(ctx: CanvasRenderingContext2D): void {
  const r = cx - 2;
  ctx.beginPath();
  ctx.arc(cx, cx, r, 0, Math.PI * 2);
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = LINE_W;
  ctx.stroke();

  // Dot at center
  ctx.beginPath();
  ctx.arc(cx, cx, 2, 0, Math.PI * 2);
  ctx.fillStyle = STROKE;
  ctx.fill();
}

/** Square — Estimated Position. */
function drawSquare(ctx: CanvasRenderingContext2D): void {
  const s = cx - 2;
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = LINE_W;
  ctx.strokeRect(cx - s, cx - s, s * 2, s * 2);

  // Dot at center
  ctx.beginPath();
  ctx.arc(cx, cx, 2, 0, Math.PI * 2);
  ctx.fillStyle = STROKE;
  ctx.fill();
}

/** Triangle — Running fix. */
function drawTriangle(ctx: CanvasRenderingContext2D): void {
  const r = cx - 2;
  ctx.beginPath();
  // Equilateral triangle, point up
  ctx.moveTo(cx, cx - r);
  ctx.lineTo(cx + r * Math.cos(Math.PI / 6), cx + r * Math.sin(Math.PI / 6));
  ctx.lineTo(cx - r * Math.cos(Math.PI / 6), cx + r * Math.sin(Math.PI / 6));
  ctx.closePath();
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = LINE_W;
  ctx.stroke();

  // Dot at center
  ctx.beginPath();
  ctx.arc(cx, cx, 2, 0, Math.PI * 2);
  ctx.fillStyle = STROKE;
  ctx.fill();
}
