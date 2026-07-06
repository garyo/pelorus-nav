/**
 * Wires the native HardwareKeys plugin to the map (Android only):
 *  - volume-key short press  -> zoom the chart in/out
 *  - volume-key long press   -> the plugin toggles a touchscreen lock; here we
 *    just show/hide a persistent on-screen "locked" indicator.
 *
 * No-op on web/desktop, where the plugin doesn't exist.
 */

import { Capacitor } from "@capacitor/core";
import type maplibregl from "maplibre-gl";
import { HardwareKeys } from "../plugins/HardwareKeys";
import { getSettings, onSettingsChange } from "../settings";

const ZOOM_STEP = 1;

export function installHardwareKeys(map: maplibregl.Map): void {
  if (!Capacitor.isNativePlatform()) return;

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
    this.el.textContent = "🔒 Screen locked — hold a volume key to unlock";
    document.body.appendChild(this.el);
  }

  setLocked(locked: boolean): void {
    this.el.classList.toggle("visible", locked);
  }
}
