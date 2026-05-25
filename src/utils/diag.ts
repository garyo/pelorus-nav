/**
 * Persistent diagnostic logging. Forwards key lifecycle/recording events to
 * the native DiagLog file (`<externalFilesDir>/diag.log`) so the trail
 * survives WebView reloads, process restarts, and the capped logcat buffer.
 * Pull it with:
 *
 *   adb pull /sdcard/Android/data/nav.pelorus.app/files/diag.log
 *
 * No-op off-native (web builds have no plugin).
 */

import { Capacitor } from "@capacitor/core";
import { BackgroundGPS } from "../plugins/BackgroundGPS";

export function diag(tag: string, message: string): void {
  if (!Capacitor.isNativePlatform()) return;
  BackgroundGPS.appendDiag({ tag, message }).catch(() => {
    // Diagnostics must never disrupt app flow.
  });
}
