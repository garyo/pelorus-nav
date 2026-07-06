/**
 * Wires the native HardwareKeys plugin to the map (Android only):
 *  - single volume press  -> zoom the chart in/out (while unlocked)
 *  - touchscreen lock     -> engaged via the returned lock() handle (a menu
 *    item) and released by any single volume press. Here we just show/hide a
 *    persistent on-screen "locked" indicator.
 *
 * Returns a handle with lock(); a no-op stub on web/desktop.
 */

import { Capacitor } from "@capacitor/core";
import type maplibregl from "maplibre-gl";
import { HardwareKeys } from "../plugins/HardwareKeys";
import { getSettings, onSettingsChange } from "../settings";

const ZOOM_STEP = 0.5;

/** Handle for triggering the touchscreen lock from elsewhere (e.g. a menu). */
export interface HardwareKeysHandle {
  lock(): void;
}

export function installHardwareKeys(map: maplibregl.Map): HardwareKeysHandle {
  if (!Capacitor.isNativePlatform()) return { lock: () => {} };

  const pushEnabled = (enabled: boolean): void => {
    HardwareKeys.setEnabled({ enabled }).catch((err) =>
      console.debug("HardwareKeys.setEnabled failed:", err),
    );
  };
  pushEnabled(getSettings().volumeKeyControls);
  onSettingsChange((s) => pushEnabled(s.volumeKeyControls));

  HardwareKeys.addListener("volumeKey", ({ key }) => {
    // Instant setZoom (no fly animation) — snappy, and avoids the smeary
    // partial-refresh animation on e-ink. MapLibre clamps to min/max zoom.
    const delta = key === "in" ? ZOOM_STEP : -ZOOM_STEP;
    map.setZoom(map.getZoom() + delta);
  });

  const banner = new TouchLockBanner();
  HardwareKeys.addListener("touchLock", ({ locked }) =>
    banner.setLocked(locked),
  );

  return {
    lock: () => {
      HardwareKeys.lock().catch((err) =>
        console.debug("HardwareKeys.lock failed:", err),
      );
    },
  };
}

/**
 * Persistent full-width indicator shown while the touchscreen is locked. It is
 * view-only — the native layer does the actual touch blocking — so it never
 * needs to (and can't) receive taps. Kept above every other overlay.
 */
class TouchLockBanner {
  private readonly el: HTMLDivElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "touch-lock-banner";
    this.el.textContent = "🔒 Screen locked — press a volume key to unlock";
    document.body.appendChild(this.el);
  }

  setLocked(locked: boolean): void {
    this.el.classList.toggle("visible", locked);
  }
}
