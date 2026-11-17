/**
 * In a browser with no position source, the instruments just read "--" and
 * the app looks like a chart viewer: offer an external GPS or the simulator.
 * Shown once a while after startup with no fix, until dismissed once; the
 * native apps always have the device's GPS and never show it.
 */

import { Capacitor } from "@capacitor/core";
import { getSettings } from "../settings";
import { showUpdateNotice } from "./updateNotice";

const NOTICE_ID = "no-gps-hint";
export const NO_GPS_HINT_DISMISSED_KEY = "pelorus-nav-no-gps-hint-dismissed";
/** Long enough for a browser's own location to arrive when it can. */
const WAIT_MS = 15_000;

/** Sources with no receiver of their own: none, or the browser's location. */
const DEVICE_SOURCES = new Set(["none", "browser-gps"]);

/**
 * Offer the hint: a browser, a source relying on the device's own location,
 * no fix yet, and not dismissed before.
 */
export function shouldOfferNoGpsHint(opts: {
  native: boolean;
  gpsSource: string;
  hasFix: boolean;
  dismissed: boolean;
}): boolean {
  return (
    !opts.native &&
    DEVICE_SOURCES.has(opts.gpsSource) &&
    !opts.hasFix &&
    !opts.dismissed
  );
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(NO_GPS_HINT_DISMISSED_KEY) !== null;
  } catch {
    return false;
  }
}

function rememberDismissed(): void {
  try {
    localStorage.setItem(NO_GPS_HINT_DISMISSED_KEY, "1");
  } catch {
    // Private mode: the hint may return next visit, which is harmless.
  }
}

export function startNoGpsHint(opts: {
  hasFix: () => boolean;
  openGpsSettings: () => void;
}): void {
  setTimeout(() => {
    const offer = shouldOfferNoGpsHint({
      native: Capacitor.isNativePlatform(),
      gpsSource: getSettings().gpsSource,
      hasFix: opts.hasFix(),
      dismissed: wasDismissed(),
    });
    if (!offer) return;
    showUpdateNotice({
      id: NOTICE_ID,
      message:
        "No GPS on this device. Connect an external GPS or try the simulator.",
      actionLabel: "GPS settings",
      dismissLabel: "Dismiss",
      onAction: () => {
        rememberDismissed();
        opts.openGpsSettings();
      },
      onDismiss: rememberDismissed,
    });
  }, WAIT_MS);
}
