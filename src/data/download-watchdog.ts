/**
 * Stall detection for streamed downloads. A connection the OS has silently
 * dropped (typically while the app is backgrounded) can leave `fetch` or
 * `reader.read()` pending forever; the watchdog turns that into a failure
 * the download queue can see and retry.
 */

/** A download that receives nothing for this long is treated as stalled. */
export const STALL_TIMEOUT_MS = 60_000;

export const STALL_ERROR_NAME = "StallError";

export function stallError(timeoutMs: number = STALL_TIMEOUT_MS): Error {
  const err = new Error(
    `download stalled — no data for ${Math.round(timeoutMs / 1000)} s`,
  );
  err.name = STALL_ERROR_NAME;
  return err;
}

export interface StallWatchdog {
  /** Record activity, restarting the countdown. */
  kick(): void;
  stop(): void;
}

/** Call `onStall` once `timeoutMs` passes without a `kick()`; the countdown starts immediately. */
export function stallWatchdog(
  timeoutMs: number,
  onStall: () => void,
): StallWatchdog {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const kick = (): void => {
    clearTimeout(timer);
    timer = setTimeout(onStall, timeoutMs);
  };
  kick();
  return { kick, stop: () => clearTimeout(timer) };
}
