/**
 * Canvas-drawn point icons for measurement, route, and track features.
 * Each point has a "role" property ("start", "waypoint", or "finish")
 * that selects the icon via a data-driven icon-image expression.
 *
 * Call ensurePointIcons(map) once per style load. All icons share the
 * same size so symbol layers align consistently.
 */

import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";
import type maplibregl from "maplibre-gl";

const SIZE = 28;

/** Icon names keyed by role — use with ["get", "role"] expressions. */
export const POINT_ICON_START = "_pt-start";
export const POINT_ICON_WAYPOINT = "_pt-waypoint";
export const POINT_ICON_FINISH = "_pt-finish";
export const POINT_ICON_MIDPOINT = "_pt-midpoint";
export const POINT_ICON_ANCHOR = "_pt-anchor";
export const POINT_ICON_HAZARD = "_pt-hazard";
export const POINT_ICON_FUEL = "_pt-fuel";
export const POINT_ICON_POI = "_pt-poi";

/** Register all point icons on the map. Safe to call multiple times. */
export function ensurePointIcons(map: maplibregl.Map): void {
  addIcon(map, POINT_ICON_START, drawStart);
  addIcon(map, POINT_ICON_WAYPOINT, drawWaypoint);
  addIcon(map, POINT_ICON_FINISH, drawFinish);
  addIcon(map, POINT_ICON_MIDPOINT, drawMidpoint);
  addIcon(map, POINT_ICON_ANCHOR, drawAnchor);
  addIcon(map, POINT_ICON_HAZARD, drawHazard);
  addIcon(map, POINT_ICON_FUEL, drawFuel);
  addIcon(map, POINT_ICON_POI, drawPoi);
}

/**
 * MapLibre expression that maps a feature's "role" property to the
 * correct icon name. Use as the value for "icon-image" in a symbol layer.
 *
 * Falls back to the waypoint icon for unknown roles.
 */
export const ROLE_ICON_EXPR: ExpressionSpecification = [
  "match",
  ["get", "role"],
  "start",
  POINT_ICON_START,
  "finish",
  POINT_ICON_FINISH,
  "midpoint",
  POINT_ICON_MIDPOINT,
  POINT_ICON_WAYPOINT, // default
];

/**
 * MapLibre expression that maps a standalone waypoint's "icon" property
 * to the correct icon name. Falls back to the default waypoint icon.
 */
export const WAYPOINT_ICON_EXPR: ExpressionSpecification = [
  "match",
  ["get", "icon"],
  "anchorage",
  POINT_ICON_ANCHOR,
  "hazard",
  POINT_ICON_HAZARD,
  "fuel",
  POINT_ICON_FUEL,
  "poi",
  POINT_ICON_POI,
  POINT_ICON_WAYPOINT, // default
];

// --- Measurement pin icons ---

export const POINT_ICON_MEASURE_START = "_pt-measure-start";
export const POINT_ICON_MEASURE_END = "_pt-measure-end";

/** Expression mapping measurement roles to pin icons. */
export const MEASURE_ICON_EXPR: ExpressionSpecification = [
  "match",
  ["get", "role"],
  "start",
  POINT_ICON_MEASURE_START,
  "finish",
  POINT_ICON_MEASURE_END,
  POINT_ICON_MEASURE_START, // default
];

/** Register measurement pin icons. Safe to call multiple times. */
export function ensureMeasureIcons(map: maplibregl.Map): void {
  addPinIcon(map, POINT_ICON_MEASURE_START, drawStartPin);
  addPinIcon(map, POINT_ICON_MEASURE_END, drawFinishPin);
}

const PIN_W = 20;
const PIN_H = 30;

function addPinIcon(
  map: maplibregl.Map,
  name: string,
  draw: (ctx: CanvasRenderingContext2D) => void,
): void {
  const ratio = window.devicePixelRatio || 1;
  const pw = Math.round(PIN_W * ratio);
  const ph = Math.round(PIN_H * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    console.warn(`point-icons: canvas 2D context unavailable for "${name}"`);
    return;
  }
  ctx.scale(ratio, ratio);
  draw(ctx);
  const imageData = {
    width: pw,
    height: ph,
    data: ctx.getImageData(0, 0, pw, ph).data,
  };
  if (map.hasImage(name)) map.removeImage(name);
  map.addImage(name, imageData, { pixelRatio: ratio });
}

/** Clip to pin outline and return key geometry for decoration. */
function clipPinPath(ctx: CanvasRenderingContext2D): {
  cx: number;
  arcCenterY: number;
  r: number;
  tipY: number;
} {
  const cx = PIN_W / 2;
  const r = PIN_W / 2 - 2;
  const tipY = PIN_H - 1;
  const arcCenterY = r + 2;
  const tangentAngle = Math.asin(r / (tipY - arcCenterY));
  const startAngle = Math.PI / 2 + tangentAngle;
  const endAngle = Math.PI / 2 - tangentAngle;

  ctx.beginPath();
  ctx.arc(cx, arcCenterY, r, startAngle, endAngle);
  ctx.lineTo(cx, tipY);
  ctx.closePath();
  return { cx, arcCenterY, r, tipY };
}

/** Green pin with white play triangle — measurement start. */
function drawStartPin(ctx: CanvasRenderingContext2D): void {
  const { cx, arcCenterY, r, tipY } = clipPinPath(ctx);

  ctx.fillStyle = "#22aa44";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();

  // White right-pointing triangle in the round part
  const s = r * 0.55;
  ctx.beginPath();
  ctx.moveTo(cx + s, arcCenterY);
  ctx.lineTo(cx - s * 0.5, arcCenterY - s * 0.85);
  ctx.lineTo(cx - s * 0.5, arcCenterY + s * 0.85);
  ctx.closePath();
  ctx.fillStyle = "#fff";
  ctx.fill();

  // Tip dot
  ctx.beginPath();
  ctx.arc(cx, tipY, 1.5, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
}

/** Checkerboard pin — measurement end. */
function drawFinishPin(ctx: CanvasRenderingContext2D): void {
  const { cx, arcCenterY, r, tipY } = clipPinPath(ctx);

  // Clip to pin shape for checkerboard
  ctx.save();
  ctx.clip();

  // Checkerboard in the round area
  const cells = 4;
  const left = cx - r;
  const top = arcCenterY - r;
  const cell = (r * 2) / cells;
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? "#000" : "#fff";
      ctx.fillRect(left + col * cell, top + row * cell, cell, cell);
    }
  }

  // Fill the tapered part below the circle solid
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.moveTo(cx - r, arcCenterY + r * 0.5);
  ctx.lineTo(cx + r, arcCenterY + r * 0.5);
  ctx.lineTo(cx, tipY);
  ctx.closePath();
  ctx.fill();

  ctx.restore();

  // Re-draw outline on top
  clipPinPath(ctx);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Tip dot
  ctx.beginPath();
  ctx.arc(cx, tipY, 1.5, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
}

/** Assign a role to a waypoint by position. */
export function pointRole(index: number, total: number): string {
  if (total <= 1) return "waypoint";
  if (index === 0) return "start";
  if (index === total - 1) return "finish";
  return "waypoint";
}

// --- Drawing helpers ---

function addIcon(
  map: maplibregl.Map,
  name: string,
  draw: (ctx: CanvasRenderingContext2D) => void,
): void {
  const ratio = window.devicePixelRatio || 1;
  const px = Math.round(SIZE * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    console.warn(`point-icons: canvas 2D context unavailable for "${name}"`);
    return;
  }
  ctx.scale(ratio, ratio);
  draw(ctx);
  const imageData = {
    width: px,
    height: px,
    data: ctx.getImageData(0, 0, px, px).data,
  };
  if (map.hasImage(name)) map.removeImage(name);
  map.addImage(name, imageData, { pixelRatio: ratio });
}

/** Green circle with white arrow pointing right/forward. */
function drawStart(ctx: CanvasRenderingContext2D): void {
  const cx = SIZE / 2;

  // Green filled circle
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 1.5, 0, Math.PI * 2);
  ctx.fillStyle = "#22aa44";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.stroke();

  // White right-pointing triangle
  const s = SIZE * 0.28;
  ctx.beginPath();
  ctx.moveTo(cx + s, cx);
  ctx.lineTo(cx - s * 0.5, cx - s * 0.85);
  ctx.lineTo(cx - s * 0.5, cx + s * 0.85);
  ctx.closePath();
  ctx.fillStyle = "#fff";
  ctx.fill();
}

/** Solid color circle with white border — the "normal" waypoint. */
function drawWaypoint(ctx: CanvasRenderingContext2D): void {
  const cx = SIZE / 2;
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 1.5, 0, Math.PI * 2);
  ctx.fillStyle = "#ff8800";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.stroke();
}

/** Small semi-transparent circle with plus — ghost midpoint for insertion. */
function drawMidpoint(ctx: CanvasRenderingContext2D): void {
  const cx = SIZE / 2;
  const r = cx * 0.55;

  ctx.beginPath();
  ctx.arc(cx, cx, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(68, 136, 204, 0.5)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Plus sign
  const s = r * 0.55;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - s, cx);
  ctx.lineTo(cx + s, cx);
  ctx.moveTo(cx, cx - s);
  ctx.lineTo(cx, cx + s);
  ctx.stroke();
}

/** Blue circle with anchor symbol. */
function drawAnchor(ctx: CanvasRenderingContext2D): void {
  const cx = SIZE / 2;
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 1.5, 0, Math.PI * 2);
  ctx.fillStyle = "#3366cc";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Anchor symbol (simplified)
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cx - 4, 2.5, 0, Math.PI * 2); // ring
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cx - 1.5);
  ctx.lineTo(cx, cx + 6); // shaft
  ctx.moveTo(cx - 4, cx + 3);
  ctx.lineTo(cx, cx + 6);
  ctx.lineTo(cx + 4, cx + 3); // flukes
  ctx.stroke();
}

/** Red circle with exclamation mark. */
function drawHazard(ctx: CanvasRenderingContext2D): void {
  const cx = SIZE / 2;
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 1.5, 0, Math.PI * 2);
  ctx.fillStyle = "#cc2222";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Exclamation mark
  ctx.fillStyle = "#fff";
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("!", cx, cx);
}

/** Green circle with fuel pump. */
function drawFuel(ctx: CanvasRenderingContext2D): void {
  const cx = SIZE / 2;
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 1.5, 0, Math.PI * 2);
  ctx.fillStyle = "#228833";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.stroke();

  // "F" letter
  ctx.fillStyle = "#fff";
  ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("F", cx, cx);
}

/** Purple circle with star. */
function drawPoi(ctx: CanvasRenderingContext2D): void {
  const cx = SIZE / 2;
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 1.5, 0, Math.PI * 2);
  ctx.fillStyle = "#8833aa";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Star symbol
  ctx.fillStyle = "#fff";
  ctx.font = "16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("★", cx, cx + 1);
}

/** Checkerboard circle — finish flag. */
function drawFinish(ctx: CanvasRenderingContext2D): void {
  const cx = SIZE / 2;
  const cells = 4;

  // Circular clip
  ctx.beginPath();
  ctx.arc(cx, cx, cx, 0, Math.PI * 2);
  ctx.clip();

  // Checkerboard
  const cell = SIZE / cells;
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? "#000" : "#fff";
      ctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }

  // White border ring
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.stroke();
}
