/**
 * Plain-text chart-download reporting: the fragments of ChartCachePanel's
 * download lines in the persistent diag log, and the bug report's
 * DOWNLOADS section.
 */

import type { PartialDownload } from "../data/tile-store";
import { formatBytes, formatDurationShort } from "../utils/format";

/** One download in ChartCachePanel's queue. */
export interface DownloadQueueItem {
  filename: string;
  state: "downloading" | "queued" | "waiting";
  /** Transient failures that used up a retry. */
  attempts: number;
  /** Runs started, including those that failed while the app was hidden. */
  runs: number;
  loaded: number;
  total: number;
}

/** A failed download run, or a download refused for lack of storage. */
export interface DownloadFailure {
  filename: string;
  message: string;
  /** When it failed (ms since epoch). */
  at: number;
  /** The queue kept the download to try again. */
  retrying: boolean;
}

/** How many failures the session keeps for the bug report. */
export const MAX_RECENT_FAILURES = 20;

/** Append `failure` to `log`, dropping the oldest beyond MAX_RECENT_FAILURES. */
export function recordFailure(
  log: DownloadFailure[],
  failure: DownloadFailure,
): void {
  log.push(failure);
  if (log.length > MAX_RECENT_FAILURES) {
    log.splice(0, log.length - MAX_RECENT_FAILURES);
  }
}

/** ChartCachePanel's download state. */
export interface DownloadPanelState {
  queue: DownloadQueueItem[];
  /** This session's latest failures, oldest first, whatever the rows show. */
  recentFailures: DownloadFailure[];
  /** Updates found by the panel's last check; null before it has checked. */
  pendingUpdates: number | null;
}

/** "340.0 MB / 812.3 MB (41%)", or "340.0 MB / ?" when the size is unknown. */
export function formatProgress(loaded: number, total: number): string {
  if (total <= 0) return `${formatBytes(loaded)} / ?`;
  const pct = Math.floor((loaded / total) * 100);
  return `${formatBytes(loaded)} / ${formatBytes(total)} (${pct}%)`;
}

/** "2.7 MB/s", or "?" over no time. */
export function formatRate(bytes: number, ms: number): string {
  if (ms <= 0) return "?";
  return `${formatBytes(Math.round((bytes * 1000) / ms))}/s`;
}

/** "fresh, 812.3 MB" or "resume at 120.0 MB / 812.3 MB (14%)". */
export function formatDownloadStart(from: number, total: number): string {
  if (from > 0) return `resume at ${formatProgress(from, total)}`;
  return `fresh, ${total > 0 ? formatBytes(total) : "size unknown"}`;
}

/**
 * "812.3 MB in 4m @ 3.2 MB/s", or with a resume
 * "812.3 MB (692.3 MB fetched) in 4m @ 2.7 MB/s" — the rate counts only
 * the bytes this run fetched.
 */
export function formatDownloadDone(
  size: number,
  from: number,
  elapsedMs: number,
): string {
  const fetched = size - from;
  const bytes =
    from > 0
      ? `${formatBytes(size)} (${formatBytes(fetched)} fetched)`
      : formatBytes(size);
  return `${bytes} in ${formatDurationShort(elapsedMs)} @ ${formatRate(fetched, elapsedMs)}`;
}

function formatQueueItem(item: DownloadQueueItem): string {
  const progress =
    item.loaded > 0 || item.total > 0
      ? formatProgress(item.loaded, item.total)
      : "not started";
  return `  ${item.state.padEnd(11)} ${item.filename}  ${progress}  runs ${item.runs}, retries ${item.attempts}`;
}

function formatFailure(f: DownloadFailure, now: number): string {
  const when = `${new Date(f.at).toISOString()} (${formatDurationShort(now - f.at)} ago)`;
  const outcome = f.retrying ? "; queued for retry" : "";
  return `  ${when}  ${f.filename}: ${f.message}${outcome}`;
}

function formatPartial(p: PartialDownload, now: number): string {
  const resume = p.resume
    ? `resume at ${formatProgress(p.resume.bytes, p.resume.total)}`
    : "no resume record";
  return `  ${p.filename}  ${formatBytes(p.bytes)}, written ${formatDurationShort(now - p.modifiedAt)} ago, ${resume}`;
}

/**
 * The DOWNLOADS section: the panel's queue, recent failures and pending updates
 * (null when the panel isn't available), then the partial downloads kept
 * in storage.
 */
export function formatDownloadSection(
  panel: DownloadPanelState | null,
  partials: readonly PartialDownload[],
  now: number,
): string {
  const lines: string[] = [];
  if (panel) {
    lines.push(`queue: ${panel.queue.length}`);
    lines.push(...panel.queue.map(formatQueueItem));
    lines.push(`recent failures: ${panel.recentFailures.length}`);
    lines.push(...panel.recentFailures.map((f) => formatFailure(f, now)));
    lines.push(
      `updates available: ${panel.pendingUpdates ?? "(not checked this session)"}`,
    );
  } else {
    lines.push("(chart panel not wired)");
  }
  lines.push(`partial downloads: ${partials.length}`);
  lines.push(...partials.map((p) => formatPartial(p, now)));
  return lines.join("\n");
}
