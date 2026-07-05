/**
 * Persistence for the chosen Web Serial GPS device (USB vendor/product ids).
 * Pairing state, not a user preference — mirrors bleDeviceStore. Lets the
 * provider re-find the granted port via navigator.serial.getPorts() after a
 * page reload or an unplug/replug, without re-showing the picker.
 */

import {
  createJsonStorageSlot,
  defaultBrowserStorage,
  type StorageLike,
} from "../utils/json-storage-slot";

export interface SavedSerialDevice {
  vendorId: number;
  productId: number;
}

const KEY = "pelorus-nav-serial-device";

function isSavedSerialDevice(value: unknown): value is SavedSerialDevice {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.vendorId === "number" && typeof v.productId === "number";
}

const slot = createJsonStorageSlot<SavedSerialDevice>(KEY, isSavedSerialDevice);

export function loadSavedSerialDevice(
  storage: StorageLike | null = defaultBrowserStorage(),
): SavedSerialDevice | null {
  return slot.load(storage);
}

export function saveSerialDevice(
  device: SavedSerialDevice,
  storage: StorageLike | null = defaultBrowserStorage(),
): void {
  slot.save(device, storage);
}

export function clearSavedSerialDevice(
  storage: StorageLike | null = defaultBrowserStorage(),
): void {
  slot.clear(storage);
}
