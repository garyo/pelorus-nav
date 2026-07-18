/**
 * Persistence for a chosen Bluetooth GPS device — one slot per transport.
 * Pairing state, not a user preference — kept out of settings.ts (precedent:
 * MAP_POS_KEY, main.ts). Lets a provider reconnect after an app restart or
 * device reboot without re-showing its device picker.
 */

import {
  createJsonStorageSlot,
  defaultBrowserStorage,
  type StorageLike,
} from "../utils/json-storage-slot";

export interface SavedDevice {
  /** BLE deviceId or Classic MAC — stable across sessions. */
  deviceId: string;
  name?: string;
}

function isSavedDevice(value: unknown): value is SavedDevice {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.deviceId === "string" &&
    (v.name === undefined || typeof v.name === "string")
  );
}

export interface SavedDeviceSlot {
  load(storage?: StorageLike | null): SavedDevice | null;
  save(device: SavedDevice, storage?: StorageLike | null): void;
  clear(storage?: StorageLike | null): void;
}

export function createSavedDeviceSlot(key: string): SavedDeviceSlot {
  const slot = createJsonStorageSlot<SavedDevice>(key, isSavedDevice);
  return {
    load: (storage = defaultBrowserStorage()) => slot.load(storage),
    save: (device, storage = defaultBrowserStorage()) =>
      slot.save(device, storage),
    clear: (storage = defaultBrowserStorage()) => slot.clear(storage),
  };
}

/** The BLE NUS pod (BLENMEAProvider / CapacitorBLENMEAProvider). */
export const bleDeviceStore = createSavedDeviceSlot("pelorus-nav-ble-device");

/** Bluetooth Classic SPP receivers (CapacitorSPPNMEAProvider). */
export const sppDeviceStore = createSavedDeviceSlot("pelorus-nav-spp-device");
