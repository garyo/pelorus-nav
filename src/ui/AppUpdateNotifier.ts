/**
 * Service worker registration + reload notice for new app builds (web PWA only).
 *
 * The SW is built with skipWaiting + clientsClaim (`registerType: "autoUpdate"`
 * in vite.config.ts), so a new build activates and takes control of open tabs
 * as soon as it installs — no waiting for every tab to close, which is what
 * left mobile PWAs stuck on stale builds in "prompt" mode. Taking control only
 * changes which SW answers future network requests; the page already has the
 * old JS loaded in memory, so it still needs a reload to run the new code.
 *
 * Registration happens directly against the native ServiceWorkerContainer
 * rather than vite-plugin-pwa's generated `virtual:pwa-register` wrapper:
 * that wrapper's "autoUpdate" template reloads immediately on activation with
 * no way to defer it. This module instead waits for an idle moment.
 *
 * On Capacitor the SW is disabled entirely (see vite.config.ts) and this is
 * a no-op.
 */

import { Capacitor } from "@capacitor/core";
import { showUpdateNotice } from "./updateNotice";

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const IDLE_RELOAD_DELAY_MS = 10_000;

/**
 * @param isBusy Read-only check for "don't reload right now" — e.g. active
 * navigation or track recording in progress. Defaults to never busy.
 */
export function startAppUpdateNotifier(
  isBusy: () => boolean = () => false,
): void {
  if (Capacitor.isNativePlatform() || !("serviceWorker" in navigator)) return;

  // A controller already present at load time means an earlier SW is serving
  // this page, so the first controllerchange from here on is a genuine
  // update. On a fresh install there's no prior controller — clientsClaim
  // still fires one controllerchange as the new SW first claims the page,
  // which isn't an update and has nothing to reload away from, so that
  // initial event is skipped and only the next one is treated as an update.
  let sawInitialClaim = !!navigator.serviceWorker.controller;
  let handledUpdate = false;

  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .then((registration) => {
      const check = () => {
        if (navigator.onLine) registration.update().catch(() => {});
      };
      setInterval(check, UPDATE_CHECK_INTERVAL_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    })
    .catch(() => {
      // registration failed — app still works without offline caching
    });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!sawInitialClaim) {
      sawInitialClaim = true;
      return;
    }
    if (handledUpdate) return;
    handledUpdate = true;

    const cancelIdleReload = reloadWhenIdle(isBusy);
    showUpdateNotice({
      id: "app-update-notice",
      message: "Updating to the latest version…",
      actionLabel: "Reload now",
      onAction: () => {
        cancelIdleReload();
        window.location.reload();
      },
      onDismiss: cancelIdleReload,
    });
  });
}

/**
 * Reload once the page is idle and not busy: no pointer/key input for
 * IDLE_RELOAD_DELAY_MS while visible, or the next time the page comes back
 * into view after being backgrounded. If `isBusy()` is true when a reload
 * would otherwise fire, it's deferred and retried after another idle period
 * instead of dropped — an active passage never loses the pending update.
 * Returns a function that cancels the pending reload entirely (wired to
 * "Later" and "Reload now" so neither leaves a reload armed in the background).
 */
function reloadWhenIdle(isBusy: () => boolean): () => void {
  let disposed = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const attemptReload = () => {
    if (disposed) return;
    if (isBusy()) {
      armIdleTimer();
      return;
    }
    window.location.reload();
  };

  const armIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(attemptReload, IDLE_RELOAD_DELAY_MS);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") attemptReload();
  };

  document.addEventListener("pointerdown", armIdleTimer, { passive: true });
  document.addEventListener("keydown", armIdleTimer);
  document.addEventListener("visibilitychange", onVisibilityChange);
  if (document.visibilityState === "visible") armIdleTimer();

  return () => {
    disposed = true;
    clearTimeout(idleTimer);
    document.removeEventListener("pointerdown", armIdleTimer);
    document.removeEventListener("keydown", armIdleTimer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
