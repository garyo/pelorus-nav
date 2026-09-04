/**
 * How long the auto course line should be, in screen pixels, for the line
 * to stay on screen: the distance from the vessel to the viewport edge
 * along its on-screen heading, less a margin. Pure geometry — the caller
 * turns pixels into minutes at the current speed and zoom.
 */

export interface Viewport {
  width: number;
  height: number;
}

/** Fraction of the ray to the edge the line reaches for. */
export const EDGE_FRACTION = 0.8;
/** Never shorter than this fraction of the viewport's short side… */
export const MIN_FRACTION = 0.3;
/** …and a vessel off screen gets a bit less than one screen. */
export const OFFSCREEN_FRACTION = 0.8;

/**
 * Length of the ray from `origin` in screen direction `headingDeg`
 * (0 = up, 90 = right) to the edge of a `w`×`h` rectangle. Infinity when
 * the origin is outside and the ray never enters; 0 when it starts on an
 * edge heading out.
 */
export function rayToEdgePx(
  origin: { x: number; y: number },
  headingDeg: number,
  viewport: Viewport,
): number {
  const rad = (headingDeg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  let t = Number.POSITIVE_INFINITY;
  const hit = (dist: number) => {
    if (dist >= 0 && dist < t) t = dist;
  };
  if (dx > 1e-9) hit((viewport.width - origin.x) / dx);
  if (dx < -1e-9) hit(-origin.x / dx);
  if (dy > 1e-9) hit((viewport.height - origin.y) / dy);
  if (dy < -1e-9) hit(-origin.y / dy);
  return t;
}

/**
 * Screen-pixel length for the auto course line, given the vessel's screen
 * position and on-screen heading (course minus map bearing).
 */
export function autoAheadPx(
  vesselPx: { x: number; y: number },
  screenHeadingDeg: number,
  viewport: Viewport,
): number {
  const short = Math.min(viewport.width, viewport.height);
  const onScreen =
    vesselPx.x >= 0 &&
    vesselPx.x <= viewport.width &&
    vesselPx.y >= 0 &&
    vesselPx.y <= viewport.height;
  if (!onScreen) return OFFSCREEN_FRACTION * short;
  const ray = rayToEdgePx(vesselPx, screenHeadingDeg, viewport);
  const target = EDGE_FRACTION * ray;
  return Math.min(
    Math.max(viewport.width, viewport.height),
    Math.max(MIN_FRACTION * short, target),
  );
}
