import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stateful fake for the BluetoothSerial plugin surface the provider touches.
// State lives on vi.hoisted so the mock factory can reach it (hoisting).
const fake = vi.hoisted(() => ({
  enabled: true,
  connectFailTimes: 0,
  bondedDevices: [] as Array<{ deviceId: string; name: string }>,
  bondedFail: false,
  dataCallback: null as ((event: { data: string }) => void) | null,
  disconnectedCallback: null as (() => void) | null,
  calls: {
    connect: [] as string[],
    getBondedDevices: 0,
    disconnect: 0,
  },
  reset() {
    this.enabled = true;
    this.connectFailTimes = 0;
    this.bondedDevices = [{ deviceId: "AA:BB", name: "Garmin GLO" }];
    this.bondedFail = false;
    this.dataCallback = null;
    this.disconnectedCallback = null;
    this.calls = { connect: [], getBondedDevices: 0, disconnect: 0 };
  },
}));

vi.mock("../plugins/BluetoothSerial", () => ({
  BluetoothSerial: {
    isEnabled: vi.fn(() => Promise.resolve({ enabled: fake.enabled })),
    getBondedDevices: vi.fn(() => {
      fake.calls.getBondedDevices++;
      if (fake.bondedFail || !fake.enabled) {
        return Promise.reject(new Error("Bluetooth is off"));
      }
      return Promise.resolve({ devices: fake.bondedDevices });
    }),
    connect: vi.fn(({ deviceId }: { deviceId: string }) => {
      fake.calls.connect.push(deviceId);
      if (!fake.enabled) return Promise.reject(new Error("Bluetooth is off"));
      if (fake.connectFailTimes > 0) {
        fake.connectFailTimes--;
        return Promise.reject(new Error("Connect failed"));
      }
      return Promise.resolve();
    }),
    disconnect: vi.fn(() => {
      fake.calls.disconnect++;
      return Promise.resolve();
    }),
    addListener: vi.fn((event: string, cb: unknown) => {
      if (event === "data") {
        fake.dataCallback = cb as (event: { data: string }) => void;
      } else if (event === "disconnected") {
        fake.disconnectedCallback = cb as () => void;
      }
      return Promise.resolve({ remove: () => Promise.resolve() });
    }),
    removeAllListeners: vi.fn(() => Promise.resolve()),
  },
}));

import { CapacitorSPPNMEAProvider } from "./CapacitorSPPNMEAProvider";
import type { NavigationData } from "./NavigationData";
import type { ProviderNotice } from "./ProviderNotice";

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

/** Compute the NMEA checksum and return the full `$...*HH\r\n` line. */
function sentence(body: string): string {
  let cs = 0;
  for (let i = 0; i < body.length; i++) cs ^= body.charCodeAt(i);
  return `$${body}*${cs.toString(16).toUpperCase().padStart(2, "0")}\r\n`;
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("CapacitorSPPNMEAProvider", () => {
  let storage: Storage;
  let notices: ProviderNotice[];
  let chosen: { deviceId: string; name: string } | null;
  let chooserCalls: number;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fake.reset();
    storage = fakeLocalStorage();
    vi.stubGlobal("localStorage", storage);
    notices = [];
    chosen = { deviceId: "AA:BB", name: "Garmin GLO" };
    chooserCalls = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const makeProvider = () =>
    new CapacitorSPPNMEAProvider(
      () => {
        chooserCalls++;
        return Promise.resolve(chosen);
      },
      (n) => notices.push(n),
    );

  it("first connect shows the chooser and persists the chosen device", async () => {
    const provider = makeProvider();
    provider.connect();
    await flush();

    expect(chooserCalls).toBe(1);
    expect(provider.isConnected()).toBe(true);
    expect(
      JSON.parse(storage.getItem("pelorus-nav-spp-device") ?? "{}"),
    ).toEqual({ deviceId: "AA:BB", name: "Garmin GLO" });
  });

  it("connects via the saved device without showing the chooser", async () => {
    storage.setItem(
      "pelorus-nav-spp-device",
      JSON.stringify({ deviceId: "AA:BB", name: "Garmin GLO" }),
    );
    const provider = makeProvider();
    provider.connect();
    await flush();

    expect(chooserCalls).toBe(0);
    expect(fake.calls.connect).toContain("AA:BB");
    expect(provider.isConnected()).toBe(true);
  });

  it("parses streamed NMEA into fixes", async () => {
    vi.setSystemTime(new Date("1994-03-23T12:40:00Z"));
    const provider = makeProvider();
    const fixes: NavigationData[] = [];
    provider.subscribe((d) => fixes.push(d));
    provider.connect();
    await flush();

    fake.dataCallback?.({
      data: sentence(
        "GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,,",
      ),
    });
    fake.dataCallback?.({
      data: sentence(
        "GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,",
      ),
    });

    expect(fixes).toHaveLength(1);
    expect(fixes[0].latitude).toBeCloseTo(48.1173, 3);
    expect(fixes[0].sog).toBeCloseTo(22.4, 1);
    expect(fixes[0].source).toBe("bt-spp");
  });

  it("reconnects silently after a link drop", async () => {
    const provider = makeProvider();
    provider.connect();
    await flush();
    expect(provider.isConnected()).toBe(true);
    const connectsSoFar = fake.calls.connect.length;

    fake.disconnectedCallback?.();
    expect(provider.isConnected()).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);

    expect(fake.calls.connect.length).toBeGreaterThan(connectsSoFar);
    expect(provider.isConnected()).toBe(true);
    expect(chooserCalls).toBe(1); // no re-pick on reconnect
  });

  it("connect with Bluetooth off emits bt-off, keeps intent, resumes on bt-on", async () => {
    storage.setItem(
      "pelorus-nav-spp-device",
      JSON.stringify({ deviceId: "AA:BB", name: "Garmin GLO" }),
    );
    fake.enabled = false;
    const provider = makeProvider();
    provider.connect();
    await flush();

    expect(notices).toContainEqual({ kind: "bt-off" });
    expect(provider.isConnected()).toBe(false);
    expect(provider.isReconnecting()).toBe(true); // intent survived

    fake.enabled = true;
    await vi.advanceTimersByTimeAsync(6000); // bt-off poll fires

    expect(notices).toContainEqual({ kind: "bt-on" });
    expect(provider.isConnected()).toBe(true);
    expect(chooserCalls).toBe(0); // silent resume
  });

  it("cancelled chooser drops the intent with a notice", async () => {
    chosen = null;
    const provider = makeProvider();
    provider.connect();
    await flush();

    expect(provider.isConnected()).toBe(false);
    expect(provider.isReconnecting()).toBe(false);
    expect(notices.some((n) => n.kind === "picker-cancelled")).toBe(true);
  });

  it("no bonded devices drops the intent with a connect-failed notice", async () => {
    fake.bondedDevices = [];
    const provider = makeProvider();
    provider.connect();
    await flush();

    expect(chooserCalls).toBe(0);
    expect(provider.isConnected()).toBe(false);
    expect(notices.some((n) => n.kind === "connect-failed")).toBe(true);
  });

  it("pickNewDevice forgets the saved device and re-runs the chooser", async () => {
    const provider = makeProvider();
    provider.connect();
    await flush();
    expect(provider.isConnected()).toBe(true);

    chosen = { deviceId: "CC:DD", name: "Other GPS" };
    await provider.pickNewDevice();
    await flush();

    expect(chooserCalls).toBe(2);
    expect(fake.calls.connect).toContain("CC:DD");
    expect(
      JSON.parse(storage.getItem("pelorus-nav-spp-device") ?? "{}").deviceId,
    ).toBe("CC:DD");
  });

  it("transient connect failures retry on backoff and recover", async () => {
    storage.setItem(
      "pelorus-nav-spp-device",
      JSON.stringify({ deviceId: "AA:BB", name: "Garmin GLO" }),
    );
    fake.connectFailTimes = 2;
    const provider = makeProvider();
    provider.connect();
    await flush();
    expect(provider.isConnected()).toBe(false);

    await vi.advanceTimersByTimeAsync(10000);
    expect(provider.isConnected()).toBe(true);
  });
});
