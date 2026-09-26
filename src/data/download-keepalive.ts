/**
 * Keeps a backgrounded Android app's network up while chart downloads run.
 *
 * Android cuts the network of a background app that has no foreground
 * service, which kills a download the moment the user switches away. While
 * the download queue has work, the native ChartDownload service holds the
 * app in the foreground-service state and shows the progress in a
 * notification. Elsewhere this is a no-op: iOS suspends a backgrounded
 * WebView whatever the app does, and the web has no such service. There,
 * an interrupted download resumes when the app returns (ChartCachePanel).
 */

import { Capacitor } from "@capacitor/core";
import type { DownloadQueueItem } from "../diagnostics/downloadReport";
import { ChartDownload } from "../plugins/ChartDownload";

/** A download in the queue, as the notification describes it. */
export interface KeepAliveItem {
  label: string;
  state: DownloadQueueItem["state"];
  loaded: number;
  total: number;
}

/**
 * What the notification shows: the text, and the active download's percent
 * (-1 for an indeterminate bar) in its progress bar and header.
 */
export interface KeepAliveStatus {
  text: string;
  percent: number;
}

/** Percent-only notification updates are sent at most this often. */
const MIN_UPDATE_MS = 2_000;

/**
 * The notification for this queue, or null when the service should not run:
 * nothing queued, or only downloads waiting for a network the device doesn't
 * have while the app is in the background — they cannot progress until it
 * returns, and an idle service would only use up Android's time allowance.
 */
export function keepAliveStatus(
  queue: readonly KeepAliveItem[],
  env: { hidden: boolean; online: boolean },
): KeepAliveStatus | null {
  if (queue.length === 0) return null;
  if (queue.every((q) => q.state === "waiting")) {
    if (env.hidden && !env.online) return null;
    return { text: "Waiting for network…", percent: -1 };
  }
  const head = queue.find((q) => q.state === "downloading") ?? queue[0];
  const more = queue.length - 1;
  const percent =
    head.state === "downloading" && head.total > 0
      ? Math.min(100, Math.floor((head.loaded / head.total) * 100))
      : -1;
  const text = more > 0 ? `${head.label} · ${more} more queued` : head.label;
  return { text, percent };
}

/**
 * Runs the native service to match the download queue. Call [sync] whenever
 * the queue or its progress changes; visibility and connectivity changes are
 * picked up here.
 */
export class DownloadKeepAlive {
  private readonly enabled = Capacitor.getPlatform() === "android";
  private isRunning = false;
  /** Last status asked of the service: null after a stop, undefined before any sync. */
  private sent: KeepAliveStatus | null | undefined;
  private sentAt = 0;
  /** Numbers native calls, so a late reply can't override a newer request. */
  private generation = 0;

  private readonly items: () => KeepAliveItem[];

  constructor(items: () => KeepAliveItem[]) {
    this.items = items;
    if (!this.enabled) return;
    const sync = (): void => this.sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    void ChartDownload.addListener("stopped", () => {
      this.generation++;
      this.isRunning = false;
      this.sent = null;
    });
    // Also stops a service left running by a page that has since reloaded.
    this.sync();
  }

  /** The service is up, so the network works while the app is hidden. */
  get running(): boolean {
    return this.isRunning;
  }

  sync(): void {
    if (!this.enabled) return;
    const want = keepAliveStatus(this.items(), {
      hidden: document.hidden,
      online: navigator.onLine,
    });
    if (!want) {
      if (this.sent !== null) {
        this.generation++;
        this.isRunning = false;
        this.sent = null;
        ChartDownload.stop().catch(() => {});
      }
      return;
    }
    // Android starts a foreground service only for an app in the foreground.
    if (!this.isRunning && document.hidden) return;
    const prev = this.sent;
    if (
      prev?.text === want.text &&
      (prev.percent === want.percent ||
        Date.now() - this.sentAt < MIN_UPDATE_MS)
    ) {
      return;
    }
    this.sent = want;
    this.sentAt = Date.now();
    const generation = ++this.generation;
    ChartDownload.start(want)
      .then(({ running }) => {
        if (generation === this.generation) this.isRunning = running;
      })
      .catch(() => {
        if (generation === this.generation) this.isRunning = false;
      });
  }
}
