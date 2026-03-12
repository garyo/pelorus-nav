/**
 * Screen Wake Lock controller.
 * Keeps the screen on based on the wake lock setting:
 * - "off": never acquire
 * - "when-nav": acquire when a GPS source is active (not "none")
 * - "always": acquire whenever the page is visible
 */

import type { WakeLockMode } from "../settings";

export class WakeLockController {
  private sentinel: WakeLockSentinel | null = null;
  private mode: WakeLockMode = "off";
  private gpsActive = false;

  constructor() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.tryAcquire();
      }
      // Released automatically when hidden — no action needed
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

  private shouldBeActive(): boolean {
    if (!("wakeLock" in navigator)) return false;
    if (document.visibilityState !== "visible") return false;
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
  }

  private tryAcquire(): void {
    if (!this.shouldBeActive()) return;
    if (this.sentinel) return; // already held

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

  private release(): void {
    if (this.sentinel) {
      this.sentinel.release().catch(() => {});
      this.sentinel = null;
    }
  }
}
