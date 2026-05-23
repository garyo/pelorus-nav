/**
 * One-shot dialog warning the user that the device's screen-off timeout
 * is too short for marine navigation.
 *
 * Many Android devices ship with 10-30 minute screen-off timeouts, and on
 * e-ink devices (BIGME / XRZ-firmware) the vendor screensaver hijacks
 * focus when that timer fires, so our FLAG_KEEP_SCREEN_ON can't keep the
 * chart visible. The reliable fix is for the user to set a much longer
 * timeout in OS Display settings. The dialog points them at it.
 */

import { Capacitor } from "@capacitor/core";
import { BackgroundGPS } from "../plugins/BackgroundGPS";

const STORAGE_KEY = "pelorus-nav-screen-timeout-warned";
/** Warn when the OS screen-off timeout is below this many minutes. */
export const SCREEN_TIMEOUT_WARN_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Read the OS screen-off timeout. Returns null on non-native platforms
 * or if the plugin can't reach the setting.
 */
export async function readScreenOffTimeoutMs(): Promise<number | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const { ms } = await BackgroundGPS.getScreenOffTimeout();
    return ms >= 0 ? ms : null;
  } catch {
    return null;
  }
}

/** Has the user dismissed the warning previously? */
function wasDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function markDismissed(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // localStorage unavailable — accept that we may re-warn next launch.
  }
}

/** Clear the dismissed flag — exposed so a Settings entry can re-trigger the dialog. */
export function resetScreenTimeoutDismissal(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function formatTimeout(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} seconds`;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return hours === Math.round(hours)
    ? `${hours} hours`
    : `${hours.toFixed(1)} hours`;
}

/** Show the dialog. Returns a promise that resolves when the user dismisses. */
export function showScreenTimeoutDialog(currentMs: number): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "about-overlay";
    overlay.style.display = "flex";

    const card = document.createElement("div");
    card.className = "about-card screen-timeout-card";

    const title = document.createElement("div");
    title.className = "about-title";
    title.textContent = "Screen may sleep underway";
    card.appendChild(title);

    const body = document.createElement("div");
    body.className = "screen-timeout-body";
    body.innerHTML =
      `Your device's screen-off timeout is set to <b>${formatTimeout(currentMs)}</b>. ` +
      "On many Android devices — especially e-ink readers — this causes the " +
      "chart to disappear underway, even when Pelorus is asking the device to " +
      "stay awake.<br><br>" +
      "Open Display settings and set <b>Screen timeout</b> to its longest value " +
      "(often <i>Never</i> or several hours). You can change it back later.";
    card.appendChild(body);

    const buttons = document.createElement("div");
    buttons.className = "screen-timeout-buttons";

    const openBtn = document.createElement("button");
    openBtn.className = "screen-timeout-btn primary";
    openBtn.textContent = "Open Display settings";
    openBtn.addEventListener("click", () => {
      BackgroundGPS.openDisplaySettings().catch(console.error);
      markDismissed();
      close();
    });

    const dismissBtn = document.createElement("button");
    dismissBtn.className = "screen-timeout-btn";
    dismissBtn.textContent = "Don't show again";
    dismissBtn.addEventListener("click", () => {
      markDismissed();
      close();
    });

    buttons.append(openBtn, dismissBtn);
    card.appendChild(buttons);

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const close = () => {
      overlay.remove();
      resolve();
    };
  });
}

/**
 * Run the startup check: if native, timeout below threshold, and user
 * hasn't dismissed, show the dialog.
 */
export async function maybeShowScreenTimeoutWarning(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (wasDismissed()) return;
  const ms = await readScreenOffTimeoutMs();
  if (ms == null || ms >= SCREEN_TIMEOUT_WARN_THRESHOLD_MS) return;
  await showScreenTimeoutDialog(ms);
}
