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

/** ChartCachePanel's download state. */
export interface DownloadPanelState {
  queue: DownloadQueueItem[];
  /** Failures the panel's rows show. */
  failures: { filename: string; message: string }[];
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

function formatPartial(p: PartialDownload, now: number): string {
  const resume = p.resume
    ? `resume at ${formatProgress(p.resume.bytes, p.resume.total)}`
    : "no resume record";
  return `  ${p.filename}  ${formatBytes(p.bytes)}, written ${formatDurationShort(now - p.modifiedAt)} ago, ${resume}`;
}

/**
 * The DOWNLOADS section: the panel's queue, failures and pending updates
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
    lines.push(`failures shown: ${panel.failures.length}`);
    lines.push(...panel.failures.map((f) => `  ${f.filename}: ${f.message}`));
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
