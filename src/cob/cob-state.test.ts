import { describe, expect, it } from "vitest";
import type { StorageLike } from "../utils/json-storage-slot";
import {
  cobStateSlot,
  cobWaypointName,
  formatCobElapsed,
  isValidCobState,
  type PersistedCobState,
  resolvedNotes,
} from "./cob-state";

const VALID: PersistedCobState = {
  version: 1,
  startedAt: 1700000000000,
  waypointId: "abc-123",
  muted: false,
  staleAtDrop: false,
  fixAgeAtDropMs: 800,
};

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("isValidCobState", () => {
  it("accepts a valid state", () => {
    expect(isValidCobState(VALID)).toBe(true);
  });

  it("rejects junk", () => {
    expect(isValidCobState(null)).toBe(false);
    expect(isValidCobState("cob")).toBe(false);
    expect(isValidCobState({})).toBe(false);
    expect(isValidCobState({ ...VALID, version: 2 })).toBe(false);
    expect(isValidCobState({ ...VALID, waypointId: "" })).toBe(false);
    expect(isValidCobState({ ...VALID, startedAt: "now" })).toBe(false);
    expect(isValidCobState({ ...VALID, muted: undefined })).toBe(false);
    expect(isValidCobState({ ...VALID, fixAgeAtDropMs: Number.NaN })).toBe(
      false,
    );
  });
});

describe("cobStateSlot", () => {
  it("round-trips through storage", () => {
    const storage = memoryStorage();
    cobStateSlot.save(VALID, storage);
    expect(cobStateSlot.load(storage)).toEqual(VALID);
    cobStateSlot.clear(storage);
    expect(cobStateSlot.load(storage)).toBeNull();
  });

  it("discards corrupt data", () => {
    const storage = memoryStorage();
    storage.setItem("pelorus-nav-cob", "{not json");
    expect(cobStateSlot.load(storage)).toBeNull();
  });
});

describe("cobWaypointName", () => {
  it("names by wall-clock time", () => {
    expect(cobWaypointName(new Date(2026, 6, 6, 14, 32, 5))).toBe(
      "COB 14:32:05",
    );
    expect(cobWaypointName(new Date(2026, 6, 6, 0, 0, 0))).toBe("COB 00:00:00");
  });
});

describe("resolvedNotes", () => {
  it("records start, end, and duration", () => {
    const start = new Date(2026, 6, 6, 14, 32, 5).getTime();
    const end = start + 15 * 60_000 + 7_000;
    expect(resolvedNotes(start, end)).toBe(
      "Crew overboard 14:32:05, resolved 14:47:12 (15:07)",
    );
  });
});

describe("formatCobElapsed", () => {
  it("formats mm:ss and h:mm:ss", () => {
    expect(formatCobElapsed(0)).toBe("0:00");
    expect(formatCobElapsed(47_000)).toBe("0:47");
    expect(formatCobElapsed(4 * 60_000 + 32_000)).toBe("4:32");
    expect(formatCobElapsed(3_600_000 + 4 * 60_000 + 32_000)).toBe("1:04:32");
    expect(formatCobElapsed(-5)).toBe("0:00");
  });
});
