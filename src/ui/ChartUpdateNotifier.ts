/**
 * Floating notice offering updates for downloaded chart regions.
 *
 * Sweeps in the background (at most once a day) via chart-update-checker.
 * Downloaded regions out of date for more than a few days get a dismissible
 * banner: "Update" opens the Chart Regions panel, "Later" snoozes the offer.
 * Streaming regions are simply re-pinned to the latest server version —
 * no prompt needed, there's nothing to download.
 */

import {
  type ChartUpdate,
  checkForChartUpdates,
  shouldCheckForUpdates,
  snoozeChartUpdates,
} from "../data/chart-update-checker";
import { showUpdateNotice } from "./updateNotice";

/** Let the map and chart sources settle before the first sweep. */
const STARTUP_DELAY_MS = 15_000;
/** Re-test the daily gate hourly, for sessions that run for days at sea. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export interface ChartUpdateNotifierOptions {
  /** Open the Chart Regions panel, where stale regions carry update buttons. */
  showChartRegions: () => void;
  /** Refresh streaming-region version pins and rebuild the style if changed. */
  applyStreamingVersions: () => Promise<void>;
}

/** Start the periodic update sweep. */
export function startChartUpdateNotifier(
  options: ChartUpdateNotifierOptions,
): void {
  const sweep = () => {
    if (!navigator.onLine || !shouldCheckForUpdates()) return;
    checkForChartUpdates()
      .then((updates) => {
        if (updates.length > 0) showNotice(updates, options.showChartRegions);
      })
      .catch(() => {
        // offline or transient failure — retried on the next sweep
      });
    options.applyStreamingVersions().catch(() => {
      // same — last-known versions stay pinned
    });
  };
  setTimeout(sweep, STARTUP_DELAY_MS);
  setInterval(sweep, SWEEP_INTERVAL_MS);
}

function showNotice(updates: ChartUpdate[], onView: () => void): void {
  const names = updates.map((u) => u.region.name).join(", ");
  showUpdateNotice({
    message: `Newer charts available: ${names}`,
    actionLabel: "Update…",
    onAction: onView,
    onDismiss: () => snoozeChartUpdates(updates),
  });
}
