import { describe, expect, it } from "vitest";
import { createJsonStorageSlot, type StorageLike } from "./json-storage-slot";

interface Thing {
  id: number;
  name?: string;
}

function isThing(value: unknown): value is Thing {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).id === "number" &&
    ((value as Record<string, unknown>).name === undefined ||
      typeof (value as Record<string, unknown>).name === "string")
  );
}

function fakeStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

describe("createJsonStorageSlot", () => {
  it("round-trips a value", () => {
    const slot = createJsonStorageSlot<Thing>("k", isThing);
    const storage = fakeStorage();
    slot.save({ id: 1, name: "a" }, storage);
    expect(slot.load(storage)).toEqual({ id: 1, name: "a" });
  });

  it("returns null when nothing is stored", () => {
    const slot = createJsonStorageSlot<Thing>("k", isThing);
    expect(slot.load(fakeStorage())).toBeNull();
  });

  it("returns null with no storage available", () => {
    const slot = createJsonStorageSlot<Thing>("k", isThing);
    expect(slot.load(null)).toBeNull();
    expect(() => slot.save({ id: 1 }, null)).not.toThrow();
    expect(() => slot.clear(null)).not.toThrow();
  });

  it("clears the stored value", () => {
    const slot = createJsonStorageSlot<Thing>("k", isThing);
    const storage = fakeStorage();
    slot.save({ id: 1 }, storage);
    slot.clear(storage);
    expect(slot.load(storage)).toBeNull();
  });

  it("returns null and clears the key on corrupt JSON", () => {
    const slot = createJsonStorageSlot<Thing>("k", isThing);
    const storage = fakeStorage();
    storage.map.set("k", "{nope");
    expect(slot.load(storage)).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it("returns null and clears the key when validation rejects the shape", () => {
    const slot = createJsonStorageSlot<Thing>("k", isThing);
    const storage = fakeStorage();
    storage.map.set("k", JSON.stringify({ nope: true }));
    expect(slot.load(storage)).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it("swallows setItem failures", () => {
    const slot = createJsonStorageSlot<Thing>("k", isThing);
    const storage = fakeStorage();
    storage.setItem = () => {
      throw new Error("quota");
    };
    expect(() => slot.save({ id: 1 }, storage)).not.toThrow();
  });

  it("swallows removeItem failures during clear", () => {
    const slot = createJsonStorageSlot<Thing>("k", isThing);
    const storage = fakeStorage();
    storage.removeItem = () => {
      throw new Error("nope");
    };
    expect(() => slot.clear(storage)).not.toThrow();
  });

  it("swallows removeItem failures when recovering from corrupt JSON", () => {
    const slot = createJsonStorageSlot<Thing>("k", isThing);
    const storage = fakeStorage();
    storage.map.set("k", "{nope");
    storage.removeItem = () => {
      throw new Error("nope");
    };
    expect(() => slot.load(storage)).not.toThrow();
    expect(slot.load(storage)).toBeNull();
  });

  it("keeps separate keys independent", () => {
    const a = createJsonStorageSlot<Thing>("a", isThing);
    const b = createJsonStorageSlot<Thing>("b", isThing);
    const storage = fakeStorage();
    a.save({ id: 1 }, storage);
    expect(b.load(storage)).toBeNull();
    expect(a.load(storage)).toEqual({ id: 1 });
  });
});
