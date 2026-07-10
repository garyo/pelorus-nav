/**
 * Repaint throttle. Caps idle/steady-state rendering to save battery on
 * long passages — the course smoother is dt-aware, so visible motion
 * stays equally smooth at a lower frame rate. Gestures bypass the cap —
 * throttling mid-pinch makes e-ink zoom overshoot badly.
 *   - E-ink: 250 ms (4 fps) to reduce ghosting.
 *   - Thermal serious/critical: 200 ms (5 fps) to let the SoC cool down.
 *   - Everything else: 100 ms (10 fps), responsive enough for the start
 *     of a turn while saving ~50× of the GPU work between GPS fixes
 *     vs. an uncapped 60 fps animation loop.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import { getSettings } from "../settings";
import type { ThermalMonitor } from "../utils/thermal";

const FRAME_INTERVAL_EINK = 250;
const FRAME_INTERVAL_HOT = 200;
const FRAME_INTERVAL_STEADY = 100;
/**
 * Vessel stationary (see navigation/stationary.ts): nothing to interpolate
 * between fixes, so render per-fix (~1 Hz). Every fix still draws — anchor
 * swing stays visible — and gestures/camera animations bypass entirely.
 */
const FRAME_INTERVAL_STATIONARY = 1000;
/**
 * E-ink, while tiles/style are still streaming in after a move or settings
 * change: every rendered frame is a full (~1 s) panel refresh, and MapLibre
 * paints each intermediate loading state — the chart visibly redraws 10+
 * times, gaining a few features per flash. Stretching the frame spacing
 * collapses the storm into 2–3 refreshes; loading still progresses each
 * frame, and the moment everything is loaded the normal interval resumes,
 * so the final complete state renders promptly.
 */
const FRAME_INTERVAL_EINK_SETTLING = 1500;

/** Replace the map's triggerRepaint with the throttled variant. */
export function installRepaintThrottle(
  map: MapLibreMap,
  thermalMonitor: ThermalMonitor,
  isStationary: () => boolean = () => false,
): void {
  const originalTriggerRepaint = map.triggerRepaint.bind(map);
  let lastFrameTime = 0;
  let pendingFrame: ReturnType<typeof setTimeout> | null = null;
  let pendingDeadline = 0;

  const throttledRepaint = () => {
    // During gestures (pinch/pan/rotate) and the inertia that follows,
    // run at full rate so the user sees what they're doing — otherwise
    // incremental deltas pile up in MapLibre's _changes queue and the
    // accumulated motion lands all at once (overshooting zoom limits, etc).
    if (map.isMoving() || map.isZooming() || map.isRotating()) {
      if (pendingFrame) {
        clearTimeout(pendingFrame);
        pendingFrame = null;
      }
      lastFrameTime = performance.now();
      originalTriggerRepaint();
      return;
    }
    const thermalState = thermalMonitor.getState();
    const isHot = thermalState === "serious" || thermalState === "critical";
    // Note: not isStyleLoaded() — the vessel/course-line setData updates
    // keep the style perpetually "dirty", so that flag never settles here.
    const settling = !map.areTilesLoaded();
    let interval =
      getSettings().displayTheme === "eink"
        ? settling
          ? FRAME_INTERVAL_EINK_SETTLING
          : FRAME_INTERVAL_EINK
        : isHot
          ? FRAME_INTERVAL_HOT
          : FRAME_INTERVAL_STEADY;
    // Stationary is a floor, not an override: e-ink settling (1.5 s) still
    // wins, and the moment the tracker reports movement the base interval
    // resumes (the pending-frame deadline shortens on the next trigger).
    if (isStationary()) {
      interval = Math.max(interval, FRAME_INTERVAL_STATIONARY);
    }
    const now = performance.now();
    const deadline = lastFrameTime + interval;
    if (now >= deadline) {
      if (pendingFrame) {
        clearTimeout(pendingFrame);
        pendingFrame = null;
      }
      lastFrameTime = now;
      originalTriggerRepaint();
      return;
    }
    // A shorter deadline supersedes a pending longer one (e.g. the last
    // tile just loaded — render the final state now, not in 1.5 s).
    if (pendingFrame && deadline < pendingDeadline) {
      clearTimeout(pendingFrame);
      pendingFrame = null;
    }
    if (!pendingFrame) {
      pendingDeadline = deadline;
      pendingFrame = setTimeout(
        () => {
          pendingFrame = null;
          lastFrameTime = performance.now();
          originalTriggerRepaint();
        },
        Math.max(0, deadline - now),
      );
    }
  };
  map.triggerRepaint = throttledRepaint;
}
