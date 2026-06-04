/**
 * Reload notice for new app builds (web PWA only).
 *
 * The service worker runs in "prompt" mode: a new build installs in the
 * background and waits, and this module offers a reload to apply it —
 * never hot-swapping code under an active navigation session. A full app
 * restart applies the update without the prompt.
 *
 * Long-running and backgrounded sessions are covered by re-checking for a
 * new build hourly and whenever the app returns to the foreground.
 *
 * On Capacitor the PWA plugin is disabled and registerSW is a no-op stub,
 * so this is safely inert in APK builds.
 */

import { registerSW } from "virtual:pwa-register";
import { showUpdateNotice } from "./updateNotice";

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function startAppUpdateNotifier(): void {
  const updateSW = registerSW({
    onNeedRefresh() {
      showUpdateNotice({
        message: "A new version of Pelorus Nav is available.",
        actionLabel: "Reload",
        onAction: () => {
          updateSW(true).catch(() => {
            // SW message failed — a plain reload still applies the update
            window.location.reload();
          });
        },
        // "Later": the new build applies on the next full app restart
      });
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const check = () => {
        if (navigator.onLine) registration.update().catch(() => {});
      };
      setInterval(check, UPDATE_CHECK_INTERVAL_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    },
  });
}
