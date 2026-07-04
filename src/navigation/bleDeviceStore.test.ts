import { describe, expect, it } from "vitest";
import {
  clearSavedBleDevice,
  loadSavedBleDevice,
  saveBleDevice,
} from "./bleDeviceStore";

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

describe("bleDeviceStore", () => {
  it("round-trips a device", () => {
    const storage = fakeStorage();
    saveBleDevice(
      { deviceId: "AC:27:6E:7E:94:DA", name: "Pelorus-GPS" },
      storage,
    );
    expect(loadSavedBleDevice(storage)).toEqual({
      deviceId: "AC:27:6E:7E:94:DA",
      name: "Pelorus-GPS",
    });
  });

  it("returns null when nothing is saved", () => {
    expect(loadSavedBleDevice(fakeStorage())).toBeNull();
  });

  it("returns null with no storage available", () => {
    expect(loadSavedBleDevice(null)).toBeNull();
    expect(() => saveBleDevice({ deviceId: "x" }, null)).not.toThrow();
    expect(() => clearSavedBleDevice(null)).not.toThrow();
  });

  it("clears the saved device", () => {
    const storage = fakeStorage();
    saveBleDevice({ deviceId: "x" }, storage);
    clearSavedBleDevice(storage);
    expect(loadSavedBleDevice(storage)).toBeNull();
  });

  it("returns null and clears the key on corrupt JSON", () => {
    const storage = fakeStorage();
    storage.map.set("pelorus-nav-ble-device", "{nope");
    expect(loadSavedBleDevice(storage)).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it("returns null and clears the key on wrong shape", () => {
    const storage = fakeStorage();
    storage.map.set("pelorus-nav-ble-device", JSON.stringify({ id: 5 }));
    expect(loadSavedBleDevice(storage)).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it("swallows setItem failures", () => {
    const storage = fakeStorage();
    storage.setItem = () => {
      throw new Error("quota");
    };
    expect(() => saveBleDevice({ deviceId: "x" }, storage)).not.toThrow();
  });
});
