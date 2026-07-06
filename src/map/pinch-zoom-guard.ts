/**
 * Guard against runaway pinch-zoom inertia (the "zooms out to the whole
 * world by itself" bug seen on iOS).
 *
 * MapLibre records pinch-zoom deltas once per rendered frame and, on finger
 * release, turns the last 160 ms of them into an inertial `easeTo` whose
 * speed is total-delta / elapsed-time (handler_inertia.ts). When the main
 * thread stalls mid-pinch — heavy tile parsing in the iOS WebView, worst
 * while zooming out — the stalled touchmoves arrive as a burst: one frame
 * carries a large merged delta and the next follows milliseconds later, so
 * the release computes an enormous zoom speed. Upstream clamps that speed to
 * a maxSpeed of 1400 shared with pan (where it means pixels/s — for zoom it
 * allows 1400 levels/s), and the ease *duration* grows with speed, so the
 * map glides on its own to minZoom for seconds after the fingers lift.
 *
 * Both layers below key on the one property that separates gesture-release
 * eases from the app's programmatic camera moves: MapLibre passes the
 * gesture's final touchend/touchcancel as `eventData.originalEvent` (and
 * re-fires it on every `zoom` event of the ease), while app code (recenter,
 * fit-bounds, search flyTo) never sets an originalEvent.
 *
 * 1. Clamp at birth: wrap `map.easeTo` and cap a gesture-release ease's zoom
 *    target near the current zoom. No public API configures zoom inertia,
 *    hence the wrapper.
 * 2. Watchdog: if a gesture-release ease still zooms beyond any physically
 *    plausible glide (e.g. an upstream refactor bypasses the wrapper),
 *    stop() it in flight.
 */

import type maplibregl from "maplibre-gl";

/**
 * Max zoom-level change a gesture-release ease may request. Double-tap and
 * two-finger-tap zoom ease exactly ±1 level and must pass untouched; genuine
 * pinch-flick inertia works out to well under 1 level (its glide amount is
 * speed²/12 with humanly-achievable release speeds of ≤ ~3 levels/s).
 */
export const MAX_GESTURE_EASE_ZOOM_DELTA = 1;

/**
 * Duration forced onto a clamped ease — matches the tap-zoom gestures'
 * own 300 ms, so a defused runaway still ends promptly instead of creeping
 * through its original seconds-long duration.
 */
export const CLAMPED_EASE_DURATION_MS = 300;

/**
 * Watchdog trip point: total zoom drift of one gesture-release ease. Sits
 * above MAX_GESTURE_EASE_ZOOM_DELTA so it can only fire if the clamp layer
 * was bypassed.
 */
export const WATCHDOG_ZOOM_DELTA = 1.5;

/** True for the touchend/touchcancel that MapLibre attaches to gesture-release eases. */
export function isTouchGestureEndEvent(ev: unknown): boolean {
  return (
    ev instanceof Event && (ev.type === "touchend" || ev.type === "touchcancel")
  );
}

/** Clamp an inertial ease's target zoom to within `limit` of the current zoom. */
export function clampInertialZoomTarget(
  currentZoom: number,
  targetZoom: number,
  limit: number = MAX_GESTURE_EASE_ZOOM_DELTA,
): number {
  return Math.min(
    currentZoom + limit,
    Math.max(currentZoom - limit, targetZoom),
  );
}

type EaseToParams = Parameters<maplibregl.Map["easeTo"]>;

export function installPinchZoomGuard(map: maplibregl.Map): void {
  /** Zoom at the start of the current gesture-release ease (watchdog budget). */
  let glideStartZoom: number | null = null;

  // Layer 1: clamp gesture-release eases at birth.
  const rawEaseTo = map.easeTo.bind(map);
  map.easeTo = (options: EaseToParams[0], eventData?: EaseToParams[1]) => {
    const originalEvent = (eventData as { originalEvent?: unknown } | undefined)
      ?.originalEvent;
    if (
      isTouchGestureEndEvent(originalEvent) &&
      typeof options.zoom === "number"
    ) {
      // Each gesture-release ease gets a fresh watchdog budget, so e.g.
      // back-to-back two-finger taps can't accumulate into a false trip.
      glideStartZoom = map.getZoom();
      const clamped = clampInertialZoomTarget(glideStartZoom, options.zoom);
      if (clamped !== options.zoom) {
        options = {
          ...options,
          zoom: clamped,
          duration: CLAMPED_EASE_DURATION_MS,
        };
      }
    }
    return rawEaseTo(options, eventData);
  };

  // Layer 2: watchdog on the ease's own per-frame zoom events.
  map.on("zoom", (e) => {
    if (!isTouchGestureEndEvent(e.originalEvent)) {
      // Zoom driven by an active gesture or by app code — not a glide.
      glideStartZoom = null;
      return;
    }
    // Wrapper bypassed (glide never latched): budget from the first frame.
    glideStartZoom ??= map.getZoom();
    if (Math.abs(map.getZoom() - glideStartZoom) > WATCHDOG_ZOOM_DELTA) {
      glideStartZoom = null;
      map.stop();
    }
  });
  map.on("zoomend", () => {
    glideStartZoom = null;
  });
}
