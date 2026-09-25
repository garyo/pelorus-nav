/**
 * TypeScript interface for the native InstallSource Capacitor plugin
 * (Android only): which app installed Pelorus Nav.
 */

import { registerPlugin } from "@capacitor/core";

export interface InstallSourcePlugin {
  /**
   * The installing app's package name — "com.android.vending" for the Play
   * Store — or null when Android doesn't record one (adb, some sideloads).
   */
  getInstaller(): Promise<{ installer: string | null }>;
}

export const InstallSource =
  registerPlugin<InstallSourcePlugin>("InstallSource");
