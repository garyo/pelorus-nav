/**
 * Stationary-vessel detector for the repaint throttle.
 *
 * At anchor there is nothing to interpolate between GPS fixes, so the map
 * can render per-fix (~1 Hz) instead of the 10 fps smoothing cadence —
 * every real movement (swinging on the hook) still draws, since each fix
 * triggers a frame; only the tween frames between fixes are dropped.
 *
 * Deliberately conservative about claiming "stationary":
 * - requires SOG below the threshold SUSTAINED for 30 s (a gust swing or
 *   short drift resets the clock),
 * - an unknown SOG counts as moving,
 * - fixes must be actively arriving — silence is not stillness,
 * - a single fast fix exits immediately.
 */

const STATIONARY_MAX_SOG_KT = 0.5;
const STATIONARY_AFTER_MS = 30_000;
/** Without a fix this recent we can't claim the vessel is still. */
const FIX_FRESHNESS_MS = 5_000;

export interface StationaryTracker {
  onFix(sogKt: number | null): void;
  isStationary(): boolean;
}

export function createStationaryTracker(
  now: () => number = () => Date.now(),
): StationaryTracker {
  let lastMovingMs = now();
  let lastFixMs = Number.NEGATIVE_INFINITY;
  return {
    onFix(sogKt: number | null): void {
      const t = now();
      lastFixMs = t;
      if (sogKt === null || sogKt >= STATIONARY_MAX_SOG_KT) {
        lastMovingMs = t;
      }
    },
    isStationary(): boolean {
      const t = now();
      return (
        t - lastMovingMs >= STATIONARY_AFTER_MS &&
        t - lastFixMs <= FIX_FRESHNESS_MS
      );
    },
  };
}
