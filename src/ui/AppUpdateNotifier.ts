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

export function startAppUpdateNotifier(): void {
  if (Capacitor.isNativePlatform() || !("serviceWorker" in navigator)) return;

  // A controller already present at load time means an earlier SW is serving
  // this page; a controllerchange from here on is a genuine update. On a
  // fresh install there's no prior controller — clientsClaim still fires one
  // controllerchange as the new SW first claims the page, which isn't an
  // update and has nothing to reload away from, so skip wiring the listener.
  const hadController = !!navigator.serviceWorker.controller;

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

  if (hadController) {
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        showUpdateNotice({
          id: "app-update-notice",
          message: "Updating to the latest version…",
          actionLabel: "Reload now",
          onAction: () => window.location.reload(),
        });
        reloadWhenIdle();
      },
      { once: true },
    );
  }
}

/**
 * Reload once the page is idle: no pointer/key input for IDLE_RELOAD_DELAY_MS
 * while visible, or immediately the next time the page comes back into view
 * after being backgrounded — foregrounding is itself a safe transition point,
 * before the user resumes interacting with the map.
 */
function reloadWhenIdle(): void {
  if (document.visibilityState !== "visible") {
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "visible") window.location.reload();
      },
      { once: true },
    );
    return;
  }

  let idleTimer: ReturnType<typeof setTimeout>;
  const armIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => window.location.reload(),
      IDLE_RELOAD_DELAY_MS,
    );
  };
  document.addEventListener("pointerdown", armIdleTimer, { passive: true });
  document.addEventListener("keydown", armIdleTimer);
  armIdleTimer();
}
