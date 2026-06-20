import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLENMEAProvider } from "./BLENMEAProvider";

// Minimal fakes for the slice of Web Bluetooth the provider touches. The device
// and characteristic are real EventTargets so the provider's add/removeListener
// and our dispatched drop/advertisement events behave like the browser's.

class FakeCharacteristic extends EventTarget {
  startNotifications = vi.fn(() => Promise.resolve(this));
}

class FakeGatt {
  connect = vi.fn(() => {
    this.connectCount++;
    if (this.failTimes > 0) {
      this.failTimes--;
      return Promise.reject(new Error("GATT connect failed"));
    }
    const characteristic = this.characteristic;
    return Promise.resolve({
      getPrimaryService: () =>
        Promise.resolve({
          getCharacteristic: () => Promise.resolve(characteristic),
        }),
    });
  });
  disconnect = vi.fn();

  connectCount = 0;
  failTimes = 0; // make the next N connect() attempts reject
  private readonly characteristic = new FakeCharacteristic();
}

class FakeDevice extends EventTarget {
  gatt = new FakeGatt();
  watchAdvertisements?: (options?: { signal?: AbortSignal }) => Promise<void> =
    vi.fn(() => Promise.resolve());

  drop(): void {
    this.dispatchEvent(new Event("gattserverdisconnected"));
  }
  advertise(): void {
    this.dispatchEvent(new Event("advertisementreceived"));
  }
}

let device: FakeDevice;
let requestDevice: ReturnType<typeof vi.fn>;

function installBluetooth(): void {
  requestDevice = vi.fn(() => Promise.resolve(device));
  vi.stubGlobal("navigator", { bluetooth: { requestDevice } });
}

// Flush the microtask chains in pickAndConnect()/establish() (no real delay).
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("BLENMEAProvider auto-reconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    device = new FakeDevice();
    installBluetooth();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("connects and subscribes after the picker", async () => {
    const provider = new BLENMEAProvider();
    provider.connect();
    await flush();

    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(device.gatt.connect).toHaveBeenCalledTimes(1);
    expect(provider.isConnected()).toBe(true);
  });

  it("auto-reconnects after a drop without re-prompting", async () => {
    const provider = new BLENMEAProvider();
    provider.connect();
    await flush();
    expect(provider.isConnected()).toBe(true);

    device.drop();
    expect(provider.isConnected()).toBe(false);

    await vi.advanceTimersByTimeAsync(999);
    expect(device.gatt.connect).toHaveBeenCalledTimes(1); // backoff not elapsed
    await vi.advanceTimersByTimeAsync(1);

    expect(device.gatt.connect).toHaveBeenCalledTimes(2); // reconnected
    expect(requestDevice).toHaveBeenCalledTimes(1); // no second picker
    expect(provider.isConnected()).toBe(true);
  });

  it("waits for re-advertisement when a direct reconnect fails", async () => {
    const provider = new BLENMEAProvider();
    provider.connect();
    await flush();

    device.gatt.failTimes = 1; // the backoff reconnect attempt fails
    device.drop();
    await vi.advanceTimersByTimeAsync(1000);

    expect(device.gatt.connect).toHaveBeenCalledTimes(2); // attempt made + failed
    expect(provider.isConnected()).toBe(false);
    expect(device.watchAdvertisements).toHaveBeenCalledTimes(1); // escalated to watch

    device.advertise(); // peripheral is back in range
    await flush();

    expect(device.gatt.connect).toHaveBeenCalledTimes(3);
    expect(requestDevice).toHaveBeenCalledTimes(1); // still no re-pick
    expect(provider.isConnected()).toBe(true);
  });

  it("falls back to exponential backoff without advertisement support", async () => {
    device.watchAdvertisements = undefined; // browser lacks watchAdvertisements
    const provider = new BLENMEAProvider();
    provider.connect();
    await flush();

    device.gatt.failTimes = 2; // first two reconnect attempts fail
    device.drop();

    await vi.advanceTimersByTimeAsync(1000); // 1st retry (1s) → fails
    expect(device.gatt.connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000); // 2nd retry doubles to 2s → fails
    expect(device.gatt.connect).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4000); // 3rd retry doubles to 4s → succeeds
    expect(device.gatt.connect).toHaveBeenCalledTimes(4);
    expect(provider.isConnected()).toBe(true);
  });

  it("disconnect() cancels a pending reconnect", async () => {
    const provider = new BLENMEAProvider();
    provider.connect();
    await flush();

    device.drop();
    provider.disconnect(); // user switched providers before the backoff fired

    await vi.advanceTimersByTimeAsync(5000);
    expect(device.gatt.connect).toHaveBeenCalledTimes(1); // no reconnect attempt
    expect(provider.isConnected()).toBe(false);
  });

  it("does not retry when the picker is cancelled", async () => {
    requestDevice.mockReturnValueOnce(Promise.reject(new Error("cancelled")));
    const provider = new BLENMEAProvider();
    provider.connect();
    await flush();

    await vi.advanceTimersByTimeAsync(5000);
    expect(requestDevice).toHaveBeenCalledTimes(1); // chooser not reopened
    expect(device.gatt.connect).toHaveBeenCalledTimes(0);
    expect(provider.isConnected()).toBe(false);
  });

  it("reconnect() retries immediately without re-prompting", async () => {
    const provider = new BLENMEAProvider();
    provider.connect();
    await flush();

    device.drop(); // schedules a backoff reconnect ~1s out
    expect(device.gatt.connect).toHaveBeenCalledTimes(1);

    provider.reconnect(); // manual button — retry now, don't wait for backoff
    await flush();

    expect(device.gatt.connect).toHaveBeenCalledTimes(2);
    expect(requestDevice).toHaveBeenCalledTimes(1); // reused device, no chooser
    expect(provider.isConnected()).toBe(true);

    await vi.advanceTimersByTimeAsync(5000); // the cancelled backoff must not fire
    expect(device.gatt.connect).toHaveBeenCalledTimes(2);
  });

  it("reconnect() opens the picker when no device is chosen yet", async () => {
    const provider = new BLENMEAProvider();
    await provider.reconnect(); // never connected — behaves like connect()
    await flush();

    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(provider.isConnected()).toBe(true);
  });

  it("reconnect() falls back to the picker when device reuse fails", async () => {
    const provider = new BLENMEAProvider();
    provider.connect();
    await flush();
    expect(requestDevice).toHaveBeenCalledTimes(1);

    device.gatt.failTimes = 1; // silent reuse of the chosen device will fail
    await provider.reconnect();
    await flush();

    expect(requestDevice).toHaveBeenCalledTimes(2); // fell back to the chooser
    expect(provider.isConnected()).toBe(true);
  });

  it("reports isReconnecting() between a drop and recovery", async () => {
    const provider = new BLENMEAProvider();
    provider.connect();
    await flush();
    expect(provider.isReconnecting()).toBe(false);

    device.gatt.failTimes = 1; // keep the next reconnect from succeeding
    device.drop();
    expect(provider.isConnected()).toBe(false);
    expect(provider.isReconnecting()).toBe(true); // wants to be connected, isn't

    await vi.advanceTimersByTimeAsync(1000); // attempt fails → still trying
    expect(provider.isReconnecting()).toBe(true);
  });
});
