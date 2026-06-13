/**
 * Global display-time offset. Prediction overlays (tides, currents, wind) render
 * for `now + offset` instead of the wall clock, so a time-bar slider can scrub
 * the chart into the future. The vessel/GPS stays at real now — only forecast
 * overlays read this.
 *
 * Transient by design: the offset is module state with no persistence, so it
 * resets to "now" on reload. Same pub-sub shape as InteractionMode.ts. The
 * offset (not an absolute target) is stored so "+3h" stays 3h ahead as the wall
 * clock advances; `displayTime()` recomputes from `Date.now()` on every call.
 */

/** Maximum forward scrub: +48 h (covers a useful wind-forecast horizon). */
export const MAX_OFFSET_MS = 48 * 3_600_000;

type Listener = (offsetMs: number) => void;

let offsetMs = 0;
const listeners: Listener[] = [];

/** Current display time = real now + offset. */
export function displayTime(): Date {
  return new Date(Date.now() + offsetMs);
}

export function getOffsetMs(): number {
  return offsetMs;
}

/** Set the forward offset (clamped to [0, MAX_OFFSET_MS]); notifies on change. */
export function setOffsetMs(ms: number): void {
  const next = Math.max(0, Math.min(MAX_OFFSET_MS, ms));
  if (next === offsetMs) return;
  offsetMs = next;
  for (const fn of listeners) {
    fn(offsetMs);
  }
}

/** Subscribe to offset changes. Returns an unsubscribe function. */
export function onChange(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}
