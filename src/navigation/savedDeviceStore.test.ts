import { describe, expect, it } from "vitest";
import { bleDeviceStore, createSavedDeviceSlot } from "./savedDeviceStore";

function fakeStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> & {
  map: Map<string, string>;
} {
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

describe("savedDeviceStore", () => {
  it("round-trips a device", () => {
    const storage = fakeStorage();
    bleDeviceStore.save(
      { deviceId: "AC:27:6E:7E:94:DA", name: "Pelorus-GPS" },
      storage,
    );
    expect(bleDeviceStore.load(storage)).toEqual({
      deviceId: "AC:27:6E:7E:94:DA",
      name: "Pelorus-GPS",
    });
  });

  it("returns null when nothing is saved", () => {
    expect(bleDeviceStore.load(fakeStorage())).toBeNull();
  });

  it("returns null with no storage available", () => {
    expect(bleDeviceStore.load(null)).toBeNull();
    expect(() => bleDeviceStore.save({ deviceId: "x" }, null)).not.toThrow();
    expect(() => bleDeviceStore.clear(null)).not.toThrow();
  });

  it("clears the saved device", () => {
    const storage = fakeStorage();
    bleDeviceStore.save({ deviceId: "x" }, storage);
    bleDeviceStore.clear(storage);
    expect(bleDeviceStore.load(storage)).toBeNull();
  });

  it("returns null and clears the key on corrupt JSON", () => {
    const storage = fakeStorage();
    storage.map.set("pelorus-nav-ble-device", "{nope");
    expect(bleDeviceStore.load(storage)).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it("returns null and clears the key on wrong shape", () => {
    const storage = fakeStorage();
    storage.map.set("pelorus-nav-ble-device", JSON.stringify({ id: 5 }));
    expect(bleDeviceStore.load(storage)).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it("swallows setItem failures", () => {
    const storage = fakeStorage();
    storage.setItem = () => {
      throw new Error("quota");
    };
    expect(() => bleDeviceStore.save({ deviceId: "x" }, storage)).not.toThrow();
  });

  it("slots with different keys are independent", () => {
    const storage = fakeStorage();
    const a = createSavedDeviceSlot("key-a");
    const b = createSavedDeviceSlot("key-b");
    a.save({ deviceId: "AA" }, storage);
    b.save({ deviceId: "BB" }, storage);
    a.clear(storage);
    expect(a.load(storage)).toBeNull();
    expect(b.load(storage)).toEqual({ deviceId: "BB" });
  });
});
