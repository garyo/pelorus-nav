/**
 * Persistence for the chosen BLE GPS device. Pairing state, not a user
 * preference — kept out of settings.ts (precedent: MAP_POS_KEY, main.ts).
 * Lets the app reconnect to the pod after an app restart or device reboot
 * without re-showing the picker.
 */

import {
  createJsonStorageSlot,
  defaultBrowserStorage,
  type StorageLike,
} from "../utils/json-storage-slot";

export interface SavedBleDevice {
  deviceId: string;
  name?: string;
}

const KEY = "pelorus-nav-ble-device";

function isSavedBleDevice(value: unknown): value is SavedBleDevice {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.deviceId === "string" &&
    (v.name === undefined || typeof v.name === "string")
  );
}

const slot = createJsonStorageSlot<SavedBleDevice>(KEY, isSavedBleDevice);

export function loadSavedBleDevice(
  storage: StorageLike | null = defaultBrowserStorage(),
): SavedBleDevice | null {
  return slot.load(storage);
}

export function saveBleDevice(
  device: SavedBleDevice,
  storage: StorageLike | null = defaultBrowserStorage(),
): void {
  slot.save(device, storage);
}

export function clearSavedBleDevice(
  storage: StorageLike | null = defaultBrowserStorage(),
): void {
  slot.clear(storage);
}
