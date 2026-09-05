/**
 * Re-arming debounce with a ceiling: `fn` runs `ms` after the last
 * `trigger()`, but never later than `maxWaitMs` after the first trigger of
 * a burst. The ceiling is what makes it safe for a stream that never goes
 * quiet — a follow mode's per-fix moveend — where a plain debounce would
 * starve. Compare trailing-throttle.ts, which bounds staleness at `ms` but
 * fires during a burst; this one waits the burst out.
 */
export interface DebounceMaxWait {
  /** (Re)start the quiet timer; start the ceiling if none is running. */
  trigger(): void;
  /** Drop any pending fire. */
  cancel(): void;
  /** Run now and clear any pending fire. */
  flush(): void;
}

export function createDebounceMaxWait(
  fn: () => void,
  ms: number,
  maxWaitMs: number,
): DebounceMaxWait {
  let quiet: ReturnType<typeof setTimeout> | null = null;
  let ceiling: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (quiet) clearTimeout(quiet);
    if (ceiling) clearTimeout(ceiling);
    quiet = null;
    ceiling = null;
  };
  const fire = () => {
    clear();
    fn();
  };
  return {
    trigger(): void {
      if (quiet) clearTimeout(quiet);
      quiet = setTimeout(fire, ms);
      if (!ceiling) ceiling = setTimeout(fire, maxWaitMs);
    },
    cancel: clear,
    flush(): void {
      fire();
    },
  };
}
