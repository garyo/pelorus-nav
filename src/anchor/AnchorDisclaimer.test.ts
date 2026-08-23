import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageLike } from "../utils/json-storage-slot";
import {
  ANCHOR_DISCLAIMER_STORAGE_KEY,
  ANCHOR_DISCLAIMER_VERSION,
  isAnchorDisclaimerAcknowledged,
  recordAnchorDisclaimerAcknowledged,
} from "./AnchorDisclaimer";

function memoryStorage(): StorageLike & { dump(): Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

beforeEach(() => {
  vi.stubGlobal("__APP_VERSION__", "0.0.0-test");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("anchor disclaimer acknowledgment", () => {
  it("starts unacknowledged and round-trips through record", () => {
    const storage = memoryStorage();
    expect(isAnchorDisclaimerAcknowledged(storage)).toBe(false);
    recordAnchorDisclaimerAcknowledged(storage, () => 1234);
    expect(isAnchorDisclaimerAcknowledged(storage)).toBe(true);
    const saved = JSON.parse(storage.dump()[ANCHOR_DISCLAIMER_STORAGE_KEY]);
    expect(saved.version).toBe(ANCHOR_DISCLAIMER_VERSION);
    expect(saved.acceptedAt).toBe(1234);
  });

  it("a version bump forces re-acknowledgment", () => {
    const storage = memoryStorage();
    storage.setItem(
      ANCHOR_DISCLAIMER_STORAGE_KEY,
      JSON.stringify({
        version: ANCHOR_DISCLAIMER_VERSION - 1,
        acceptedAt: 1,
        appVersion: "0.0.0",
      }),
    );
    expect(isAnchorDisclaimerAcknowledged(storage)).toBe(false);
  });

  it("treats corrupt or missing storage as unacknowledged", () => {
    const storage = memoryStorage();
    storage.setItem(ANCHOR_DISCLAIMER_STORAGE_KEY, "not json{");
    expect(isAnchorDisclaimerAcknowledged(storage)).toBe(false);
    expect(isAnchorDisclaimerAcknowledged(null)).toBe(false);
  });
});
