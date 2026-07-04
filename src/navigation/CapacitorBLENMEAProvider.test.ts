import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stateful fake for the slice of BleClient the provider touches. Behavior is
// driven by the `fake` control object; the mock factory must not capture
// outer `let` bindings directly (hoisting), so state lives on vi.hoisted.
const fake = vi.hoisted(() => ({
  enabled: true,
  connectFailTimes: 0,
  knownDevices: [] as Array<{ deviceId: string; name?: string }>,
  connectedDevices: [] as Array<{ deviceId: string; name?: string }>,
  pickedDevice: { deviceId: "AA:BB", name: "Pelorus-GPS" } as {
    deviceId: string;
    name?: string;
  } | null,
  enabledCallback: null as ((value: boolean) => void) | null,
  onDisconnect: null as (() => void) | null,
  calls: {
    initialize: 0,
    requestDevice: 0,
    connect: [] as string[],
    requestEnable: 0,
  },
  reset() {
    this.enabled = true;
    this.connectFailTimes = 0;
    this.knownDevices = [];
    this.connectedDevices = [];
    this.pickedDevice = { deviceId: "AA:BB", name: "Pelorus-GPS" };
    this.enabledCallback = null;
    this.onDisconnect = null;
    this.calls = {
      initialize: 0,
      requestDevice: 0,
      connect: [],
      requestEnable: 0,
    };
  },
}));

vi.mock("@capacitor-community/bluetooth-le", () => ({
  BleClient: {
    initialize: vi.fn(() => {
      fake.calls.initialize++;
      return Promise.resolve();
    }),
    isEnabled: vi.fn(() => Promise.resolve(fake.enabled)),
    requestEnable: vi.fn(() => {
      fake.calls.requestEnable++;
      return Promise.resolve();
    }),
    openBluetoothSettings: vi.fn(() => Promise.resolve()),
    startEnabledNotifications: vi.fn((cb: (value: boolean) => void) => {
      fake.enabledCallback = cb;
      return Promise.resolve();
    }),
    stopEnabledNotifications: vi.fn(() => Promise.resolve()),
    getDevices: vi.fn((ids: string[]) =>
      Promise.resolve(
        fake.knownDevices.filter((d) => ids.includes(d.deviceId)),
      ),
    ),
    getConnectedDevices: vi.fn(() => Promise.resolve(fake.connectedDevices)),
    requestDevice: vi.fn(() => {
      fake.calls.requestDevice++;
      return fake.pickedDevice
        ? Promise.resolve(fake.pickedDevice)
        : Promise.reject(new Error("cancelled"));
    }),
    connect: vi.fn((deviceId: string, onDisconnect?: () => void) => {
      fake.calls.connect.push(deviceId);
      if (!fake.enabled) return Promise.reject(new Error("BT off"));
      if (fake.connectFailTimes > 0) {
        fake.connectFailTimes--;
        return Promise.reject(new Error("connect failed"));
      }
      fake.onDisconnect = onDisconnect ?? null;
      return Promise.resolve();
    }),
    disconnect: vi.fn(() => Promise.resolve()),
    startNotifications: vi.fn(() => Promise.resolve()),
    stopNotifications: vi.fn(() => Promise.resolve()),
    write: vi.fn(() => Promise.resolve()),
  },
}));

import type { BleNotice } from "./CapacitorBLENMEAProvider";
import { CapacitorBLENMEAProvider } from "./CapacitorBLENMEAProvider";

function fakeLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("CapacitorBLENMEAProvider", () => {
  let storage: Storage;
  let notices: BleNotice[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fake.reset();
    storage = fakeLocalStorage();
    vi.stubGlobal("localStorage", storage);
    notices = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const makeProvider = () =>
    new CapacitorBLENMEAProvider((n) => notices.push(n));

  it("first connect shows the picker and persists the chosen device", async () => {
    const provider = makeProvider();
    provider.connect();
    await flush();

    expect(fake.calls.requestDevice).toBe(1);
    expect(provider.isConnected()).toBe(true);
    expect(
      JSON.parse(storage.getItem("pelorus-nav-ble-device") ?? "{}"),
    ).toEqual({ deviceId: "AA:BB", name: "Pelorus-GPS" });
  });

  it("connects via the saved device without showing the picker", async () => {
    storage.setItem(
      "pelorus-nav-ble-device",
      JSON.stringify({ deviceId: "AA:BB", name: "Pelorus-GPS" }),
    );
    const provider = makeProvider();
    provider.connect();
    await flush();

    expect(fake.calls.requestDevice).toBe(0);
    expect(fake.calls.connect).toContain("AA:BB");
    expect(provider.isConnected()).toBe(true);
  });

  it("connect with Bluetooth off emits bt-off, keeps intent, never opens the picker", async () => {
    fake.enabled = false;
    const provider = makeProvider();
    provider.connect();
    await flush();

    expect(fake.calls.requestDevice).toBe(0);
    expect(notices).toContainEqual({ kind: "bt-off" });
    expect(provider.isConnected()).toBe(false);
    expect(provider.isReconnecting()).toBe(true); // intent survived
  });

  it("resumes automatically when Bluetooth turns on", async () => {
    storage.setItem(
      "pelorus-nav-ble-device",
      JSON.stringify({ deviceId: "AA:BB" }),
    );
    fake.enabled = false;
    const provider = makeProvider();
    provider.connect();
    await flush();
    expect(provider.isConnected()).toBe(false);

    fake.enabled = true;
    fake.enabledCallback?.(true);
    await flush();

    expect(provider.isConnected()).toBe(true);
    expect(notices).toContainEqual({ kind: "bt-on" });
    expect(fake.calls.requestDevice).toBe(0); // silent resume, no picker
  });

  it("Bluetooth turning off mid-session cancels backoff and emits bt-off", async () => {
    const provider = makeProvider();
    provider.connect();
    await flush();
    expect(provider.isConnected()).toBe(true);
    const connectsSoFar = fake.calls.connect.length;

    fake.enabled = false;
    fake.onDisconnect?.(); // link drops (schedules backoff)
    fake.enabledCallback?.(false); // then the BT-off notification lands

    await vi.advanceTimersByTimeAsync(60000);
    expect(fake.calls.connect.length).toBe(connectsSoFar); // no futile retries
    expect(notices).toContainEqual({ kind: "bt-off" });
  });

  it("picker cancel drops intent and emits picker-cancelled", async () => {
    fake.pickedDevice = null;
    const provider = makeProvider();
    provider.connect();
    await flush();

    expect(provider.isReconnecting()).toBe(false); // intent dropped
    expect(notices.some((n) => n.kind === "picker-cancelled")).toBe(true);
  });

  it("stale saved device: failures schedule capped backoff, no picker", async () => {
    storage.setItem(
      "pelorus-nav-ble-device",
      JSON.stringify({ deviceId: "DE:AD" }),
    );
    fake.connectFailTimes = Number.MAX_SAFE_INTEGER;
    const provider = makeProvider();
    provider.connect();
    await flush();

    await vi.advanceTimersByTimeAsync(120000);
    expect(fake.calls.requestDevice).toBe(0);
    expect(provider.isConnected()).toBe(false);
    expect(provider.isReconnecting()).toBe(true); // still trying
    expect(fake.calls.connect.length).toBeGreaterThan(3);
  });

  it("pickNewDevice clears the saved device and re-runs the picker", async () => {
    storage.setItem(
      "pelorus-nav-ble-device",
      JSON.stringify({ deviceId: "DE:AD" }),
    );
    fake.pickedDevice = { deviceId: "AC:27", name: "Pelorus-GPS" };
    const provider = makeProvider();
    await provider.pickNewDevice();
    await flush();

    expect(fake.calls.requestDevice).toBe(1);
    expect(provider.isConnected()).toBe(true);
    expect(
      JSON.parse(storage.getItem("pelorus-nav-ble-device") ?? "{}").deviceId,
    ).toBe("AC:27");
  });

  it("reconnect() rehydrates the saved device after an app restart", async () => {
    storage.setItem(
      "pelorus-nav-ble-device",
      JSON.stringify({ deviceId: "AA:BB", name: "Pelorus-GPS" }),
    );
    const provider = makeProvider(); // fresh instance — no in-memory device
    await provider.reconnect();
    await flush();

    expect(fake.calls.requestDevice).toBe(0); // no picker flash
    expect(provider.isConnected()).toBe(true);
  });

  it("auto-reconnects with backoff after a peripheral drop", async () => {
    const provider = makeProvider();
    provider.connect();
    await flush();
    expect(provider.isConnected()).toBe(true);

    fake.onDisconnect?.();
    expect(provider.isConnected()).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    expect(provider.isConnected()).toBe(true);
    expect(fake.calls.requestDevice).toBe(1); // still only the original picker
  });

  it("promptEnableBluetooth requests the system enable dialog", async () => {
    const provider = makeProvider();
    await provider.promptEnableBluetooth();
    expect(fake.calls.requestEnable).toBe(1);
  });

  it("emits connected notice so banners can clear", async () => {
    const provider = makeProvider();
    provider.connect();
    await flush();
    expect(notices).toContainEqual({ kind: "connected" });
  });
});
