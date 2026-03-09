/**
 * Canvas-drawn point icons for measurement, route, and track features.
 * Each point has a "role" property ("start", "waypoint", or "finish")
 * that selects the icon via a data-driven icon-image expression.
 *
 * Call ensurePointIcons(map) once per style load. All icons share the
 * same size so symbol layers align consistently.
 */

import type maplibregl from "maplibre-gl";

const SIZE = 28;

/** Icon names keyed by role — use with ["get", "role"] expressions. */
export const POINT_ICON_START = "_pt-start";
export const POINT_ICON_WAYPOINT = "_pt-waypoint";
export const POINT_ICON_FINISH = "_pt-finish";
export const POINT_ICON_MIDPOINT = "_pt-midpoint";

/** Register all point icons on the map. Safe to call multiple times. */
export function ensurePointIcons(map: maplibregl.Map): void {
  if (map.hasImage(POINT_ICON_START)) return;

  addIcon(map, POINT_ICON_START, drawStart);
  addIcon(map, POINT_ICON_WAYPOINT, drawWaypoint);
  addIcon(map, POINT_ICON_FINISH, drawFinish);
  addIcon(map, POINT_ICON_MIDPOINT, drawMidpoint);
}

/**
 * MapLibre expression that maps a feature's "role" property to the
 * correct icon name. Use as the value for "icon-image" in a symbol layer.
 *
 * Falls back to the waypoint icon for unknown roles.
 */
export const ROLE_ICON_EXPR: maplibregl.ExpressionSpecification = [
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
  const px = SIZE * ratio;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(ratio, ratio);
  draw(ctx);
  map.addImage(
    name,
    { width: px, height: px, data: ctx.getImageData(0, 0, px, px).data },
    { pixelRatio: ratio },
  );
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
