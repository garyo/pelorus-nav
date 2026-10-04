/**
 * The one toast for a recording the system interrupted — shared by the
 * backlog-recovery notice and the resumed-track gap notice (backlog-notice.ts
 * words both). On Android it offers the remedy: the "Settings" action opens
 * the battery-exemption dialog or, once the app is exempt, its system
 * settings page; on Samsung phones the message also names the separate
 * sleeping-apps limit. iOS and web get the message alone — there is no
 * equivalent setting to open.
 */

import { Capacitor } from "@capacitor/core";
import { BackgroundGPS } from "../plugins/BackgroundGPS";
import { showToast } from "../ui/Toast";
import { withVendorAdvice } from "./backlog-notice";

/** Long enough to read two sentences and reach for the action. */
const NOTICE_MS = 12_000;

let manufacturer: Promise<string | null> | null = null;

/** Lowercased device manufacturer, asked of the native side once; null when
 *  it can't say (an older native shell). */
function deviceManufacturer(): Promise<string | null> {
  manufacturer ??= BackgroundGPS.getBackgroundInfo().then(
    (info) => info.manufacturer,
    (err: unknown) => {
      console.error("getBackgroundInfo failed:", err);
      return null;
    },
  );
  return manufacturer;
}

/**
 * Show `message`; `offerRemedy` adds the Android settings action and vendor
 * advice — pass false when the hole was too short to be the system's doing.
 */
export async function showInterruptionToast(
  message: string,
  offerRemedy: boolean,
): Promise<void> {
  if (!offerRemedy || Capacitor.getPlatform() !== "android") {
    showToast({ message, durationMs: NOTICE_MS });
    return;
  }
  showToast({
    message: withVendorAdvice(message, await deviceManufacturer()),
    durationMs: NOTICE_MS,
    actionLabel: "Settings",
    onAction: () => {
      BackgroundGPS.openBackgroundSettings().catch(console.error);
    },
  });
}
