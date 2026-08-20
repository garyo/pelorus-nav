/**
 * Offline outbox for bug reports. A report composed offshore (offline) is
 * persisted to IndexedDB and uploaded automatically once the network is
 * back — triggered by the browser `online` event and a startup flush.
 * Server rejections (HTTP 4xx/5xx) drop the entry rather than retrying
 * forever: the report reached the server and was refused, so it will never
 * succeed as-is. Network-level failures keep the entry for the next try.
 */

import { appErrorLog } from "../diagnostics/errorLog";
import { outboxAdd, outboxDelete, outboxGetAll } from "./db";
import { chartAssetBase } from "./remote-url";

const UPLOAD_TIMEOUT_MS = 20_000;
/** Startup flush delay — let app boot and connectivity settle first. */
const STARTUP_FLUSH_DELAY_MS = 15_000;

export interface BugReportPayload {
  description: string;
  email: string;
  diagnostics: string;
  screenshot?: string;
}

interface QueuedBugReport extends BugReportPayload {
  queuedAt: string;
}

/** POST a bug report; throws on network failure or non-2xx response. */
export async function sendBugReport(report: BugReportPayload): Promise<void> {
  const res = await fetch(`${chartAssetBase()}/api/bug-report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report),
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Persist a report for later automatic upload. */
export async function queueBugReport(report: BugReportPayload): Promise<void> {
  const queued: QueuedBugReport = {
    ...report,
    queuedAt: new Date().toISOString(),
  };
  await outboxAdd(queued);
}

let flushing = false;

/**
 * Try to upload every queued report, oldest first. Stops at the first
 * network failure (still offline); safe to call opportunistically.
 */
export async function flushBugReportOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const entries = await outboxGetAll();
    for (const { key, record } of entries) {
      const r = record as QueuedBugReport;
      try {
        await sendBugReport({
          ...r,
          diagnostics: `(queued offline at ${r.queuedAt})\n${r.diagnostics}`,
        });
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("HTTP")) {
          // Reached the server and was rejected — a retry can't succeed.
          appErrorLog.log(
            "bug-report",
            "error",
            `queued report rejected: ${err.message}`,
          );
          await outboxDelete(key);
          continue;
        }
        return; // still offline — leave the rest for the next trigger
      }
      await outboxDelete(key);
    }
  } catch (err) {
    appErrorLog.log("bug-report", "error", `outbox flush: ${String(err)}`);
  } finally {
    flushing = false;
  }
}

/** Wire the automatic flush triggers (call once at startup). */
export function initBugReportOutbox(): void {
  window.addEventListener("online", () => void flushBugReportOutbox());
  setTimeout(() => {
    if (navigator.onLine) void flushBugReportOutbox();
  }, STARTUP_FLUSH_DELAY_MS);
}
