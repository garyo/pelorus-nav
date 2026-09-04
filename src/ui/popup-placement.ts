/**
 * Keep a popup inside the visible viewport. Pure geometry, shared by the
 * map context menu and its submenu; the callers measure the DOM and apply
 * the result.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Viewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

const MARGIN = 4;

/**
 * Place a `w`×`h` popup at (x, y), pulled back inside the viewport (minus
 * the system-UI insets) when it would overflow. Never pushes it above or
 * left of the viewport's own edge.
 */
export function clampToViewport(
  x: number,
  y: number,
  w: number,
  h: number,
  vp: Viewport,
  insets: Insets = NO_INSETS,
): { x: number; y: number } {
  const minX = vp.left + insets.left + MARGIN;
  const minY = vp.top + insets.top + MARGIN;
  const maxX = vp.left + vp.width - insets.right - MARGIN - w;
  const maxY = vp.top + vp.height - insets.bottom - MARGIN - h;
  return {
    x: Math.max(minX, Math.min(x, maxX)),
    y: Math.max(minY, Math.min(y, maxY)),
  };
}

/**
 * Place a `w`×`h` submenu beside its parent row: to the right by
 * preference, flipped to the left when that overflows, and clamped over
 * the parent when neither side fits. Vertically it aligns with the row's
 * top and slides up as needed.
 */
export function placeSubmenu(
  parent: Rect,
  w: number,
  h: number,
  vp: Viewport,
  insets: Insets = NO_INSETS,
): { x: number; y: number } {
  const rightEdge = vp.left + vp.width - insets.right - MARGIN;
  const leftEdge = vp.left + insets.left + MARGIN;
  let x = parent.left + parent.width;
  if (x + w > rightEdge) {
    const flipped = parent.left - w;
    x = flipped >= leftEdge ? flipped : x;
  }
  return clampToViewport(x, parent.top - MARGIN, w, h, vp, insets);
}
