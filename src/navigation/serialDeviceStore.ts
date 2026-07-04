/**
 * Persistence for the chosen Web Serial GPS device (USB vendor/product ids).
 * Pairing state, not a user preference — mirrors bleDeviceStore. Lets the
 * provider re-find the granted port via navigator.serial.getPorts() after a
 * page reload or an unplug/replug, without re-showing the picker.
 */

export interface SavedSerialDevice {
  vendorId: number;
  productId: number;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "pelorus-nav-serial-device";

function defaultStorage(): StorageLike | null {
  return typeof localStorage !== "undefined" ? localStorage : null;
}

export function loadSavedSerialDevice(
  storage: StorageLike | null = defaultStorage(),
): SavedSerialDevice | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).vendorId === "number" &&
      typeof (parsed as Record<string, unknown>).productId === "number"
    ) {
      return parsed as SavedSerialDevice;
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

export function saveSerialDevice(
  device: SavedSerialDevice,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(device));
  } catch {
    // quota/privacy failures — connection still works, just not persisted
  }
}

export function clearSavedSerialDevice(
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // ignore
  }
}
