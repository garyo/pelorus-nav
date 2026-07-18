/**
 * Generic plumbing for a single JSON value persisted to `localStorage`-shaped
 * storage: parse-and-validate on load (corrupt or wrong-shaped data clears the
 * key and falls back to absent), swallow write failures (quota/privacy), and
 * tolerate a missing storage backend entirely. Shared by the small pairing
 * stores (`savedDeviceStore`, `serialDeviceStore`) and `ConnectionEventLog`,
 * which previously each reimplemented this by hand.
 */

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** `localStorage` when available (browser), otherwise `null` (SSR/tests). */
export function defaultBrowserStorage(): StorageLike | null {
  return typeof localStorage !== "undefined" ? localStorage : null;
}

export interface JsonStorageSlot<T> {
  /** Read and validate the stored value; corrupt/invalid data is discarded. */
  load(storage: StorageLike | null): T | null;
  /** Write the value; failures (quota, privacy mode) are swallowed. */
  save(value: T, storage: StorageLike | null): void;
  /** Remove the stored value. */
  clear(storage: StorageLike | null): void;
}

/**
 * Create a slot for one storage key holding a single JSON-serializable value
 * of type `T`, validated by `isValid` on the way back in.
 */
export function createJsonStorageSlot<T>(
  key: string,
  isValid: (value: unknown) => value is T,
): JsonStorageSlot<T> {
  return {
    load(storage) {
      if (!storage) return null;
      try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (isValid(parsed)) return parsed;
        storage.removeItem(key);
        return null;
      } catch {
        try {
          storage.removeItem(key);
        } catch {
          // unremovable — treat as absent
        }
        return null;
      }
    },

    save(value, storage) {
      try {
        storage?.setItem(key, JSON.stringify(value));
      } catch {
        // quota/privacy failures — caller still works, just not persisted
      }
    },

    clear(storage) {
      try {
        storage?.removeItem(key);
      } catch {
        // ignore
      }
    },
  };
}
