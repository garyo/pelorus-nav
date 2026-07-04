/**
 * Persistent ring buffer for uncaught JS errors — the piece of the diagnostic
 * story TestFlight can't see (it only reports native crashes). Reuses
 * ConnectionEventLog for persistence/eviction but with its OWN storage key so
 * an error storm can never evict BLE connection history.
 *
 * Installed by errorCaptureBoot.ts as main.ts's first import, so even
 * module-initialization crashes get recorded.
 */

import { ConnectionEventLog } from "../navigation/ConnectionEventLog";

const ERROR_LOG_KEY = "pelorus-nav-error-log";
const ERROR_LOG_MAX = 100;
const STACK_LINES = 4;
const DEDUPE_WINDOW_MS = 60_000;
const MAX_PER_MINUTE = 20;

/** Dedicated persistent ring buffer for uncaught JS errors. */
export const appErrorLog = new ConnectionEventLog({
  key: ERROR_LOG_KEY,
  max: ERROR_LOG_MAX,
});

/** Format an error/rejection reason as "message | first stack lines". */
export function formatErrorDetail(reason: unknown): string {
  if (reason instanceof Error) {
    const stack = (reason.stack ?? "")
      .split("\n")
      .slice(0, STACK_LINES)
      .map((l) => l.trim())
      .join(" | ");
    return stack.startsWith(reason.message) || stack.includes(reason.message)
      ? stack
      : `${reason.message} | ${stack}`;
  }
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

interface StormState {
  lastDetail: string;
  lastSeenMs: number;
  suppressed: number;
  minuteStartMs: number;
  loggedThisMinute: number;
  stormMarked: boolean;
}

let installed = false;

/**
 * Install window "error" + "unhandledrejection" capture. Idempotent.
 * Storm guards: consecutive identical details within DEDUPE_WINDOW_MS are
 * counted rather than logged (a "repeated xN" entry flushes when the run
 * breaks), and after MAX_PER_MINUTE distinct entries in a rolling minute a
 * single "error storm" marker is logged and the rest of that minute dropped.
 */
export function installGlobalErrorCapture(
  log: ConnectionEventLog = appErrorLog,
  target: Pick<Window, "addEventListener"> = window,
): void {
  if (installed) return;
  installed = true;

  const storm: StormState = {
    lastDetail: "",
    lastSeenMs: 0,
    suppressed: 0,
    minuteStartMs: 0,
    loggedThisMinute: 0,
    stormMarked: false,
  };

  const record = (src: string, detail: string): void => {
    const now = Date.now();

    // Dedupe an unbroken run of the identical error.
    if (
      detail === storm.lastDetail &&
      now - storm.lastSeenMs < DEDUPE_WINDOW_MS
    ) {
      storm.suppressed++;
      storm.lastSeenMs = now;
      return;
    }
    if (storm.suppressed > 0) {
      log.log(src, "error", `(previous error repeated x${storm.suppressed})`);
      storm.suppressed = 0;
    }
    storm.lastDetail = detail;
    storm.lastSeenMs = now;

    // Rolling per-minute cap for storms of *distinct* errors.
    if (now - storm.minuteStartMs >= 60_000) {
      storm.minuteStartMs = now;
      storm.loggedThisMinute = 0;
      storm.stormMarked = false;
    }
    if (storm.loggedThisMinute >= MAX_PER_MINUTE) {
      if (!storm.stormMarked) {
        storm.stormMarked = true;
        log.log(
          src,
          "error",
          "(error storm — further errors this minute dropped)",
        );
      }
      return;
    }
    storm.loggedThisMinute++;
    log.log(src, "error", detail);
  };

  target.addEventListener("error", (event) => {
    const e = event as ErrorEvent;
    const detail = e.error
      ? formatErrorDetail(e.error)
      : `${e.message ?? "unknown error"} (${e.filename ?? "?"}:${e.lineno ?? "?"})`;
    record("js-error", detail);
  });

  target.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    record("unhandled-rejection", formatErrorDetail(reason));
  });
}

/** Test hook: allow re-installation in a fresh test environment. */
export function resetGlobalErrorCaptureForTests(): void {
  installed = false;
}
