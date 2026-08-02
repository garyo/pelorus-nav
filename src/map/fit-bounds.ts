/**
 * Shared "zoom to fit" helpers for tracks, routes, and search results.
 *
 * Two camera quirks live here so call sites don't repeat them:
 * - Follow mode leaves its look-ahead padding on the map transform, which
 *   badly skews a later fitBounds (the fit computes against the shrunken
 *   rect). Every fit resets the transform padding first.
 * - "Already fully visible" used to mean "don't move", even when the
 *   feature was a speck at high altitude. A feature occupying less than
 *   TINY_FRACTION of the canvas in both dimensions is re-fit anyway.
 */

import type * as maplibregl from "maplibre-gl";

/** [[west, south], [east, north]] */
export type LonLatBounds = [[number, number], [number, number]];

/** On-screen features smaller than this canvas fraction in BOTH dimensions
 *  still get a fit — they're visible but too small to be useful. */
export const TINY_FRACTION = 0.1;

const DEFAULT_OPTIONS: maplibregl.FitBoundsOptions = {
  padding: 80,
  maxZoom: 14,
  duration: 500,
};

/**
 * Whether a fit should run. Skip only when the feature is fully on-screen
 * AND large enough to be useful. Pure, for unit tests.
 */
export function needsFit(args: {
  fullyVisible: boolean;
  pxWidth: number;
  pxHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}): boolean {
  if (!args.fullyVisible) return true;
  return (
    args.pxWidth < args.canvasWidth * TINY_FRACTION &&
    args.pxHeight < args.canvasHeight * TINY_FRACTION
  );
}

/**
 * Zoom level a single point is revealed at when the map is currently wider
 * than that. Close enough to read the surrounding chart detail, not so close
 * that the user loses the context they were looking at.
 */
export const POINT_REVEAL_ZOOM = 14;

/**
 * The zoom to reveal a point at: never zoom *out* to show it. A user already
 * looking at harbour detail asked where a waypoint is, not to be pulled back
 * to a passage view.
 */
export function pointRevealZoom(
  currentZoom: number,
  minZoom = POINT_REVEAL_ZOOM,
): number {
  return Math.max(currentZoom, minZoom);
}

/**
 * Center the map on a single point, zooming in if the view is wider than
 * `minZoom`.
 *
 * Unlike the bounds fits, this always recenters, even when the point is
 * already on screen: a point has no extent to judge "well framed" by, and the
 * request came from a list, where the answer being sought is *where* — which a
 * point sitting unremarked in a corner doesn't give.
 */
export function focusMapOnPoint(
  map: maplibregl.Map,
  lonLat: [number, number],
  options?: { minZoom?: number; duration?: number },
): void {
  map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
  map.easeTo({
    center: lonLat,
    zoom: pointRevealZoom(map.getZoom(), options?.minZoom),
    duration: options?.duration ?? DEFAULT_OPTIONS.duration,
  });
}

/** Fit the map to bounds, clearing any stale look-ahead padding first. */
export function fitMapToBounds(
  map: maplibregl.Map,
  bounds: LonLatBounds,
  options?: maplibregl.FitBoundsOptions,
): void {
  map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
  map.fitBounds(bounds, { ...DEFAULT_OPTIONS, ...options });
}

/** Fit the map to bounds unless they're already well-framed on screen. */
export function fitMapToBoundsIfNeeded(
  map: maplibregl.Map,
  bounds: LonLatBounds,
  options?: maplibregl.FitBoundsOptions,
): void {
  const [[west, south], [east, north]] = bounds;
  const b = map.getBounds();
  const fullyVisible =
    west >= b.getWest() &&
    east <= b.getEast() &&
    south >= b.getSouth() &&
    north <= b.getNorth();

  // Projected pixel extent — all four corners, so rotation is handled
  const corners = [
    map.project([west, south]),
    map.project([east, south]),
    map.project([east, north]),
    map.project([west, north]),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const canvas = map.getCanvas();

  if (
    !needsFit({
      fullyVisible,
      pxWidth: Math.max(...xs) - Math.min(...xs),
      pxHeight: Math.max(...ys) - Math.min(...ys),
      canvasWidth: canvas.clientWidth,
      canvasHeight: canvas.clientHeight,
    })
  ) {
    return;
  }
  fitMapToBounds(map, bounds, options);
}
