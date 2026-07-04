/**
 * Persistence for the chosen BLE GPS device. Pairing state, not a user
 * preference — kept out of settings.ts (precedent: MAP_POS_KEY, main.ts).
 * Lets the app reconnect to the pod after an app restart or device reboot
 * without re-showing the picker.
 */

export interface SavedBleDevice {
  deviceId: string;
  name?: string;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "pelorus-nav-ble-device";

function defaultStorage(): StorageLike | null {
  return typeof localStorage !== "undefined" ? localStorage : null;
}

export function loadSavedBleDevice(
  storage: StorageLike | null = defaultStorage(),
): SavedBleDevice | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).deviceId === "string" &&
      ((parsed as Record<string, unknown>).name === undefined ||
        typeof (parsed as Record<string, unknown>).name === "string")
    ) {
      return parsed as SavedBleDevice;
    }
    storage.removeItem(KEY);
    return null;
  } catch {
    try {
      storage.removeItem(KEY);
    } catch {
      // unremovable — treat as absent
    }
    return null;
  }
}

export function saveBleDevice(
  device: SavedBleDevice,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(device));
  } catch {
    // quota/privacy failures — connection still works, just not persisted
  }
}

export function clearSavedBleDevice(
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // ignore
  }
}
