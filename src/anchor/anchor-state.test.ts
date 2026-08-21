import { describe, expect, it } from "vitest";
import type { StorageLike } from "../utils/json-storage-slot";
import {
  ANCHOR_PARAMS_STORAGE_KEY,
  ANCHOR_WATCH_STORAGE_KEY,
  anchorParamsSlot,
  anchorWatchSlot,
  isValidAnchorParams,
  isValidAnchorWatchState,
  type PersistedAnchorWatchState,
} from "./anchor-state";

function memoryStorage(): StorageLike & { dump(): Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

const VALID: PersistedAnchorWatchState = {
  version: 1,
  armedAt: 1700000000000,
  anchor: { lat: 42.0, lon: -71.0 },
  radiusM: 45,
  warnM: 8,
  muted: false,
  alarming: false,
  scatter: [{ lat: 42.0001, lon: -71.0, t: 1700000010000 }],
};

describe("isValidAnchorWatchState", () => {
  it("accepts a well-formed state", () => {
    expect(isValidAnchorWatchState(VALID)).toBe(true);
  });

  it("accepts an empty scatter array", () => {
    expect(isValidAnchorWatchState({ ...VALID, scatter: [] })).toBe(true);
  });

  it("rejects non-objects and wrong versions", () => {
    expect(isValidAnchorWatchState(null)).toBe(false);
    expect(isValidAnchorWatchState("armed")).toBe(false);
    expect(isValidAnchorWatchState({ ...VALID, version: 2 })).toBe(false);
  });

  it("rejects a missing or malformed anchor", () => {
    const { anchor: _anchor, ...rest } = VALID;
    expect(isValidAnchorWatchState(rest)).toBe(false);
    expect(isValidAnchorWatchState({ ...VALID, anchor: { lat: 42.0 } })).toBe(
      false,
    );
    expect(
      isValidAnchorWatchState({ ...VALID, anchor: { lat: "42", lon: -71 } }),
    ).toBe(false);
  });

  it("rejects non-positive or non-finite radii", () => {
    expect(isValidAnchorWatchState({ ...VALID, radiusM: 0 })).toBe(false);
    expect(isValidAnchorWatchState({ ...VALID, radiusM: Number.NaN })).toBe(
      false,
    );
    expect(isValidAnchorWatchState({ ...VALID, warnM: -1 })).toBe(false);
  });

  it("rejects malformed scatter entries", () => {
    expect(isValidAnchorWatchState({ ...VALID, scatter: "none" })).toBe(false);
    expect(
      isValidAnchorWatchState({
        ...VALID,
        scatter: [{ lat: 42.0, lon: -71.0 }],
      }),
    ).toBe(false);
  });
});

describe("isValidAnchorParams", () => {
  it("accepts full and partial parameter sets", () => {
    expect(isValidAnchorParams({ version: 1 })).toBe(true);
    expect(
      isValidAnchorParams({
        version: 1,
        boatLengthM: 11.5,
        bowHeightM: 1.2,
        lastRodeM: 40,
        lastDepthM: 5,
      }),
    ).toBe(true);
    expect(isValidAnchorParams({ version: 1, lastRodeM: 30 })).toBe(true);
  });

  it("rejects wrong versions and non-numeric fields", () => {
    expect(isValidAnchorParams(null)).toBe(false);
    expect(isValidAnchorParams({ version: 2 })).toBe(false);
    expect(isValidAnchorParams({ version: 1, boatLengthM: "11m" })).toBe(false);
    expect(isValidAnchorParams({ version: 1, lastDepthM: Number.NaN })).toBe(
      false,
    );
  });
});

describe("storage slots", () => {
  it("round-trips the armed state", () => {
    const storage = memoryStorage();
    anchorWatchSlot.save(VALID, storage);
    expect(anchorWatchSlot.load(storage)).toEqual(VALID);
    anchorWatchSlot.clear(storage);
    expect(anchorWatchSlot.load(storage)).toBeNull();
  });

  it("discards and clears corrupt armed-state JSON", () => {
    const storage = memoryStorage();
    storage.setItem(ANCHOR_WATCH_STORAGE_KEY, "{not json");
    expect(anchorWatchSlot.load(storage)).toBeNull();
    expect(storage.dump()[ANCHOR_WATCH_STORAGE_KEY]).toBeUndefined();
  });

  it("discards a wrong-structure armed slot", () => {
    const storage = memoryStorage();
    storage.setItem(
      ANCHOR_WATCH_STORAGE_KEY,
      JSON.stringify({ version: 1, armedAt: "yesterday" }),
    );
    expect(anchorWatchSlot.load(storage)).toBeNull();
    expect(storage.dump()[ANCHOR_WATCH_STORAGE_KEY]).toBeUndefined();
  });

  it("round-trips remembered params independently of the armed slot", () => {
    const storage = memoryStorage();
    const params = { version: 1 as const, boatLengthM: 10, lastRodeM: 35 };
    anchorParamsSlot.save(params, storage);
    anchorWatchSlot.clear(storage);
    expect(anchorParamsSlot.load(storage)).toEqual(params);
    expect(storage.dump()[ANCHOR_PARAMS_STORAGE_KEY]).toBeDefined();
  });
});
