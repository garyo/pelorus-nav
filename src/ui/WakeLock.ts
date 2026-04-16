/**
 * Screen Wake Lock controller.
 * Keeps the screen on based on the wake lock setting:
 * - "off": never acquire
 * - "when-nav": acquire when a GPS source is active (not "none")
 * - "always": acquire whenever the page is visible
 *
 * On native (Capacitor): uses Android FLAG_KEEP_SCREEN_ON via BackgroundGPS plugin.
 * On browser/PWA: uses the W3C Screen Wake Lock API.
 *
 * When e-ink mode is active and the wake lock is held, a 30-second timer
 * toggles a CSS class to provoke the e-ink display controller into refreshing.
 */

import { Capacitor } from "@capacitor/core";
import { BackgroundGPS } from "../plugins/BackgroundGPS";
import type { WakeLockMode } from "../settings";

const EINK_REFRESH_INTERVAL_MS = 30_000;

export class WakeLockController {
  private sentinel: WakeLockSentinel | null = null;
  private nativeActive = false;
  private mode: WakeLockMode = "off";
  private gpsActive = false;
  private einkMode = false;
  private einkRefreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.tryAcquire();
      }
      // W3C wake lock is released automatically when hidden.
      // Native FLAG_KEEP_SCREEN_ON persists — no action needed.
    });
  }

  /** Update the wake lock mode from settings. */
  setMode(mode: WakeLockMode): void {
    this.mode = mode;
    this.update();
  }

  /** Update whether GPS is active (source !== "none"). */
  setGpsActive(active: boolean): void {
    this.gpsActive = active;
    this.update();
  }

  /** Enable/disable the 30-second e-ink refresh timer. */
  setEinkMode(eink: boolean): void {
    this.einkMode = eink;
    this.updateEinkRefresh();
  }

  private shouldBeActive(): boolean {
    if (document.visibilityState !== "visible") return false;
    // On browser, check API availability
    if (!Capacitor.isNativePlatform() && !("wakeLock" in navigator))
      return false;
    switch (this.mode) {
      case "always":
        return true;
      case "when-nav":
        return this.gpsActive;
      case "off":
        return false;
    }
  }

  private update(): void {
    if (this.shouldBeActive()) {
      this.tryAcquire();
    } else {
      this.release();
    }
    this.updateEinkRefresh();
  }

  private tryAcquire(): void {
    if (!this.shouldBeActive()) return;

    if (Capacitor.isNativePlatform()) {
      if (this.nativeActive) return;
      this.nativeActive = true;
      BackgroundGPS.keepScreenOn().catch((err) => {
        console.debug("Native keepScreenOn failed:", err);
        this.nativeActive = false;
      });
    } else {
      if (this.sentinel) return;
      navigator.wakeLock
        .request("screen")
        .then((sentinel) => {
          this.sentinel = sentinel;
          sentinel.addEventListener("release", () => {
            this.sentinel = null;
          });
        })
        .catch((err) => {
          console.debug("Wake lock request failed:", err.message);
        });
    }
  }

  private release(): void {
    if (Capacitor.isNativePlatform()) {
      if (!this.nativeActive) return;
      this.nativeActive = false;
      BackgroundGPS.allowScreenOff().catch(() => {});
    } else {
      if (this.sentinel) {
        this.sentinel.release().catch(() => {});
        this.sentinel = null;
      }
    }
  }

  // ── E-ink refresh ──────────────────────────────────────────────────

  private updateEinkRefresh(): void {
    const shouldRun = this.einkMode && this.shouldBeActive();
    if (shouldRun && !this.einkRefreshTimer) {
      this.einkRefreshTimer = setInterval(() => {
        document.body.classList.toggle("eink-refresh-tick");
      }, EINK_REFRESH_INTERVAL_MS);
    } else if (!shouldRun && this.einkRefreshTimer) {
      clearInterval(this.einkRefreshTimer);
      this.einkRefreshTimer = null;
      document.body.classList.remove("eink-refresh-tick");
    }
  }
}
