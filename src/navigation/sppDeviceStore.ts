/**
 * Persistence for the chosen Bluetooth Classic SPP GPS device (e.g. Garmin
 * GLO). Pairing state, not a user preference — mirrors bleDeviceStore. Lets
 * the provider reconnect by MAC after an app restart without re-showing the
 * device chooser.
 */

import {
  createJsonStorageSlot,
  defaultBrowserStorage,
  type StorageLike,
} from "../utils/json-storage-slot";

export interface SavedSppDevice {
  deviceId: string;
  name?: string;
}

const KEY = "pelorus-nav-spp-device";

function isSavedSppDevice(value: unknown): value is SavedSppDevice {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.deviceId === "string" &&
    (v.name === undefined || typeof v.name === "string")
  );
}

const slot = createJsonStorageSlot<SavedSppDevice>(KEY, isSavedSppDevice);

export function loadSavedSppDevice(
  storage: StorageLike | null = defaultBrowserStorage(),
): SavedSppDevice | null {
  return slot.load(storage);
}

export function saveSppDevice(
  device: SavedSppDevice,
  storage: StorageLike | null = defaultBrowserStorage(),
): void {
  slot.save(device, storage);
}

export function clearSavedSppDevice(
  storage: StorageLike | null = defaultBrowserStorage(),
): void {
  slot.clear(storage);
}
