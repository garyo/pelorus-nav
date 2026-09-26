/**
 * TypeScript interface for the native ChartDownload Capacitor plugin
 * (Android only): a foreground service that keeps the app's network up
 * while chart downloads run in the background, with a progress
 * notification. See src/data/download-keepalive.ts.
 */

import type { PluginListenerHandle } from "@capacitor/core";
import { registerPlugin } from "@capacitor/core";

export interface ChartDownloadPlugin {
  /**
   * Start the service, or update its notification when it is running.
   * `percent` is 0–100, or -1 for an indeterminate bar. `running` is false
   * when Android refused the start (app in the background, or its dataSync
   * time allowance used up).
   */
  start(options: { text: string; percent: number }): Promise<{
    running: boolean;
  }>;

  stop(): Promise<void>;

  /** The service ended on its own — "timeout": Android's dataSync limit. */
  addListener(
    event: "stopped",
    listener: (data: { reason: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export const ChartDownload =
  registerPlugin<ChartDownloadPlugin>("ChartDownload");
