/**
 * TypeScript interface for the native HardwareKeys Capacitor plugin.
 *
 * Lets the app take over the device's physical volume keys (Android only):
 * a single press zooms the chart. A touchscreen lock (so accidental screen
 * presses are ignored, useful on big e-ink devices under way) is engaged via
 * lock() from a menu item and released by any single volume press. The lock
 * only covers the app's own surface — Android does not let one app swallow
 * touches destined for the system UI or other apps.
 */

import type { PluginListenerHandle } from "@capacitor/core";
import { registerPlugin } from "@capacitor/core";

export interface HardwareKeysPlugin {
  /**
   * Enable or disable volume-key interception. When disabled the keys revert
   * to normal system volume and any active touch lock is released.
   */
  setEnabled(options: { enabled: boolean }): Promise<void>;

  /**
   * Lock the touchscreen. Released by any single volume press. No-op when the
   * feature is disabled (volume keys wouldn't be intercepted to unlock).
   */
  lock(): Promise<void>;

  /** Fired on a volume-key press while unlocked: "in" = up, "out" = down. */
  addListener(
    eventName: "volumeKey",
    listenerFunc: (data: { key: "in" | "out" }) => void,
  ): Promise<PluginListenerHandle>;

  /**
   * Fired when the touchscreen lock toggles. `locked` reflects the new state;
   * the native side has already applied/removed the actual touch blocking, so
   * the web layer only needs to update its indicator.
   */
  addListener(
    eventName: "touchLock",
    listenerFunc: (data: { locked: boolean }) => void,
  ): Promise<PluginListenerHandle>;

  removeAllListeners(): Promise<void>;
}

export const HardwareKeys = registerPlugin<HardwareKeysPlugin>("HardwareKeys");
