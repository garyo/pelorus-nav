import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NavigationData } from "./NavigationData";
import type { ProviderNotice } from "./ProviderNotice";
import { WebSerialNMEAProvider } from "./WebSerialNMEAProvider";

// Fakes for the slice of Web Serial the provider touches. The port carries a
// real ReadableStream so the provider's TextDecoderStream pipe and read loop
// run for real; FakeSerial is a real EventTarget so the "connect" (replug)
// event behaves like the browser's.

/** Compute the NMEA checksum and return the full `$...*HH` sentence. */
function withChecksum(body: string): string {
  let cs = 0;
  for (let i = 0; i < body.length; i++) cs ^= body.charCodeAt(i);
  return `$${body}*${cs.toString(16).toUpperCase().padStart(2, "0")}`;
}

// A full RMC+GGA epoch — the stream emits once both sentences are in.
const RMC = withChecksum(
  "GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,,",
);
const GGA = withChecksum(
  "GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,",
);

class FakePort {
  // Mirrors real SerialPort semantics closely enough to reproduce the
  // watchdog wedge: open() throws InvalidStateError on an already-open port,
  // and close() rejects with TypeError while the readable side is locked
  // (i.e. still piped to by an active read loop).
  open = vi.fn((_opts: { baudRate: number }) => {
    this.openCount++;
    if (this.failOpenTimes > 0) {
      this.failOpenTimes--;
      return Promise.reject(new Error("open failed"));
    }
    if (this.isOpen) {
      return Promise.reject(
        new DOMException("port already open", "InvalidStateError"),
      );
    }
    this.isOpen = true;
    this.readable = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.controller = c;
      },
    });
    return Promise.resolve();
  });
  close = vi.fn(() => {
    if (!this.isOpen) return Promise.resolve();
    if (this.readable?.locked) {
      return Promise.reject(new TypeError("cannot close a locked stream"));
    }
    this.isOpen = false;
    this.readable = null;
    return Promise.resolve();
  });

  openCount = 0;
  failOpenTimes = 0; // make the next N open() attempts reject
  isOpen = false;
  readable: ReadableStream<Uint8Array> | null = null;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private readonly info: { usbVendorId?: number; usbProductId?: number };

  constructor(info: { usbVendorId?: number; usbProductId?: number }) {
    this.info = info;
  }

  getInfo() {
    return this.info;
  }

  send(text: string): void {
    this.controller?.enqueue(new TextEncoder().encode(text));
  }

  /** Device removed: the stream errors, like Chrome on a USB unplug. */
  unplug(): void {
    this.controller?.error(new Error("device lost"));
    this.controller = null;
  }
}

class FakeSerial extends EventTarget {
  ports: FakePort[] = [];
  pickedPort: FakePort | null = null;

  requestPort = vi.fn(() => {
    if (!this.pickedPort) return Promise.reject(new Error("cancelled"));
    // Granting via the picker adds the port to the getPorts() set.
    if (!this.ports.includes(this.pickedPort)) this.ports.push(this.pickedPort);
    return Promise.resolve(this.pickedPort);
  });

  getPorts = vi.fn(() => Promise.resolve([...this.ports]));

  /** Re-attach a granted device: fires the serial "connect" event. */
  plugIn(port: FakePort): void {
    if (!this.ports.includes(port)) this.ports.push(port);
    this.dispatchEvent(new Event("connect"));
  }
}

const flush = () => vi.advanceTimersByTimeAsync(0);

// The port → TextDecoderStream → reader chain crosses several microtask
// turns; fake timers don't drive those, so drain them explicitly.
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("WebSerialNMEAProvider", () => {
  let serial: FakeSerial;
  let port: FakePort;
  let notices: ProviderNotice[];
  let storage: Map<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("1994-03-23T12:40:00Z")); // matches RMC's date field
    vi.spyOn(console, "warn").mockImplementation(() => {});
    serial = new FakeSerial();
    port = new FakePort({ usbVendorId: 0x1546, usbProductId: 0x01a7 });
    serial.pickedPort = port;
    notices = [];
    storage = new Map();
    vi.stubGlobal("navigator", { serial });
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const makeProvider = () =>
    new WebSerialNMEAProvider(4800, (n) => notices.push(n));

  it("connects via the picker, reads NMEA, and persists the device ids", async () => {
    const provider = makeProvider();
    const fixes: NavigationData[] = [];
    provider.subscribe((d) => fixes.push(d));
    provider.connect();
    await flush();

    expect(serial.requestPort).toHaveBeenCalledTimes(1);
    expect(provider.isConnected()).toBe(true);
    expect(notices).toContainEqual({ kind: "connected" });
    expect(
      JSON.parse(storage.get("pelorus-nav-serial-device") ?? "{}"),
    ).toEqual({ vendorId: 0x1546, productId: 0x01a7 });

    port.send(`${RMC}\r\n${GGA}\r\n`);
    await settle();
    expect(fixes).toHaveLength(1);
    expect(fixes[0].latitude).toBeCloseTo(48.1173, 3);
    expect(fixes[0].source).toBe("web-serial");
  });

  it("restores the granted port silently — no picker", async () => {
    storage.set(
      "pelorus-nav-serial-device",
      JSON.stringify({ vendorId: 0x1546, productId: 0x01a7 }),
    );
    serial.ports.push(port); // granted in a previous session
    const provider = makeProvider();
    provider.connect();
    await flush();

    expect(serial.requestPort).toHaveBeenCalledTimes(0);
    expect(provider.isConnected()).toBe(true);
  });

  it("recovers from an unplug when the device is plugged back in", async () => {
    const provider = makeProvider();
    provider.connect();
    await flush();
    expect(provider.isConnected()).toBe(true);

    serial.ports = []; // device removed from the granted set
    port.unplug();
    await flush();
    expect(provider.isConnected()).toBe(false);
    expect(provider.isReconnecting()).toBe(true); // intent survives

    // Backoff retry finds nothing (not present) and goes idle on the
    // "connect" event instead of polling.
    await vi.advanceTimersByTimeAsync(60000);
    const replacement = new FakePort({
      usbVendorId: 0x1546,
      usbProductId: 0x01a7,
    });
    serial.plugIn(replacement); // replug fires the serial connect event
    await flush();

    expect(provider.isConnected()).toBe(true);
    expect(serial.requestPort).toHaveBeenCalledTimes(1); // never re-picked
  });

  it("retries a transient open failure on the backoff", async () => {
    port.failOpenTimes = 1; // first open fails, device stays attached
    const provider = makeProvider();
    provider.connect();
    await flush();
    expect(provider.isConnected()).toBe(false);

    await vi.advanceTimersByTimeAsync(1000); // 1s backoff retry succeeds
    expect(provider.isConnected()).toBe(true);
    expect(serial.requestPort).toHaveBeenCalledTimes(1); // no second picker
  });

  it("picker cancel drops the intent and emits picker-cancelled", async () => {
    serial.pickedPort = null;
    const provider = makeProvider();
    provider.connect();
    await flush();

    await vi.advanceTimersByTimeAsync(60000);
    expect(serial.requestPort).toHaveBeenCalledTimes(1); // not reopened
    expect(provider.isReconnecting()).toBe(false); // intent dropped
    expect(notices.some((n) => n.kind === "picker-cancelled")).toBe(true);
  });

  it("recovers from a silence-watchdog reconnect instead of wedging on the same port", async () => {
    const provider = makeProvider();
    const fixes: NavigationData[] = [];
    provider.subscribe((d) => fixes.push(d));
    provider.connect();
    await flush();
    expect(provider.isConnected()).toBe(true);
    expect(port.openCount).toBe(1);

    // Data goes silent (device still attached, just stopped sending) past the
    // default 8s watchdog limit. The forced reconnect must actually reopen
    // the port instead of wedging on a stale lock.
    await vi.advanceTimersByTimeAsync(9000);
    await settle();
    await flush();

    // Give it a few backoff cycles' worth of headroom in case the very first
    // retry lands mid-teardown; a wedged provider never recovers no matter
    // how long we wait.
    await vi.advanceTimersByTimeAsync(60000);
    await settle();
    await flush();

    expect(provider.isConnected()).toBe(true);
    expect(serial.requestPort).toHaveBeenCalledTimes(1); // never re-picked

    // The reopened port must actually carry data again.
    port.send(`${RMC}\r\n${GGA}\r\n`);
    await settle();
    expect(fixes.length).toBeGreaterThan(0);
  });

  it("disconnect() closes the port and does not reconnect", async () => {
    const provider = makeProvider();
    provider.connect();
    await flush();
    expect(provider.isConnected()).toBe(true);

    provider.disconnect();
    await vi.advanceTimersByTimeAsync(60000);
    expect(provider.isConnected()).toBe(false);
    expect(provider.isReconnecting()).toBe(false);
    expect(port.openCount).toBe(1); // never reopened
  });
});
