/**
 * Non-re-arming trailing throttle: schedules `fn` at most once per `ms`.
 *
 * Unlike a re-arming debounce (`clearTimeout` + `setTimeout` on every call),
 * a steady stream of `trigger()` calls faster than `ms` apart can't push the
 * fire out forever — once a fire is scheduled, later calls are no-ops until
 * it runs. This bounds both the max rate and the max staleness at `ms`,
 * which matters for consumers driven by MapLibre's `moveend`, firing ~10 Hz
 * while the vessel is underway in follow mode.
 */
export interface TrailingThrottle {
  /** Schedule a fire if none is already pending. */
  trigger(): void;
  /** Cancel any pending fire. */
  cancel(): void;
}

export function createTrailingThrottle(
  fn: () => void,
  ms: number,
): TrailingThrottle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    trigger(): void {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    cancel(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
