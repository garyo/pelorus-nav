/**
 * GPS provider using the Web Serial API for USB/Bluetooth NMEA GPS devices.
 * Only available in Chrome/Edge (requires navigator.serial).
 *
 * The reconnect state machine (intent, backoff, silence watchdog) lives in
 * ReconnectingTransport. Granted ports reopen with NO user gesture via
 * navigator.serial.getPorts() (verified), so an unplugged GPS recovers by
 * itself: the read loop reports the drop, the saved vendor/product match
 * re-finds the port, and the serial "connect" event wakes an idle retry the
 * moment the device is plugged back in. requestPort() (the picker) stays in
 * the gesture paths only — provider selection and the Reconnect button.
 */

import { connectionLog } from "./ConnectionEventLog";
import type {
  NavigationDataCallback,
  NavigationDataProvider,
} from "./NavigationData";
import { NMEAStream } from "./nmea-stream";
import type { ProviderNotice } from "./ProviderNotice";
import { ReconnectingTransport } from "./ReconnectingTransport";
import { loadSavedSerialDevice, saveSerialDevice } from "./serialDeviceStore";

// Extend Navigator type for the Web Serial API (not in the bundled DOM lib).
interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialPort {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  getInfo(): SerialPortInfo;
}

interface Serial extends EventTarget {
  requestPort(): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}

declare global {
  interface Navigator {
    serial?: Serial;
  }
}

// establish() throws this when the granted port isn't attached right now —
// the one failure where polling is pointless and the serial "connect" event
// (device plugged back in) is the wake-up signal.
const NOT_PRESENT = "saved GPS device not present";

export class WebSerialNMEAProvider implements NavigationDataProvider {
  readonly id = "web-serial";
  readonly name = "USB GPS (Serial)";

  private listeners: NavigationDataCallback[] = [];
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private portWatchStop: (() => void) | null = null;
  private baudRate: number;
  private readonly core: ReconnectingTransport;
  private readonly stream: NMEAStream;
  private readonly onNotice?: (notice: ProviderNotice) => void;

  constructor(baudRate = 4800, onNotice?: (notice: ProviderNotice) => void) {
    this.baudRate = baudRate;
    this.onNotice = onNotice;
    this.stream = new NMEAStream("web-serial", (data) => {
      for (const fn of this.listeners) fn(data);
    });
    this.core = new ReconnectingTransport(
      { providerId: this.id, logLabel: "Web Serial" },
      {
        establish: () => this.openPort(),
        onEstablished: () => this.handleEstablished(),
        teardown: () => this.teardownLink(),
        escalateRecovery: (err) =>
          err instanceof Error && err.message === NOT_PRESENT
            ? this.startPortWaitWatch()
            : false,
        attemptDetail: (cause) => `${this.portLabel()} (${cause})`,
      },
    );
  }

  static isAvailable(): boolean {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  isConnected(): boolean {
    return this.core.isConnected();
  }

  lastRawDataMs(): number {
    return this.core.lastRawDataMs();
  }

  isReconnecting(): boolean {
    return this.core.isReconnecting();
  }

  connect(): void {
    if (!this.core.noteConnectRequested()) return;
    void this.startConnect();
  }

  disconnect(): void {
    this.stopPortWatch();
    this.core.noteDisconnectRequested();
    this.teardownLink();
    this.stream.reset();
  }

  /**
   * Manual reconnect (UI button). Tries the granted port first (no picker);
   * if it can't be opened, falls back to the chooser while the click's
   * activation is still valid, so the button always gets you connected.
   */
  async reconnect(): Promise<void> {
    this.stopPortWatch();
    this.teardownLink();
    this.core.claimIntent();
    try {
      connectionLog.log(
        this.id,
        "connect-attempt",
        `${this.portLabel()} (manual)`,
      );
      await this.core.runEstablish("manual"); // granted port — no picker
      return;
    } catch (err) {
      console.warn("Web Serial manual reconnect failed, re-picking:", err);
    }
    await this.pickAndConnect(); // shows the picker
  }

  subscribe(callback: NavigationDataCallback): void {
    this.listeners.push(callback);
  }

  unsubscribe(callback: NavigationDataCallback): void {
    const idx = this.listeners.indexOf(callback);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  /**
   * Full connect flow: silent restore via a granted port when one is
   * attached or was saved (works without a gesture, e.g. at startup),
   * falling back to the picker (needs the gesture from provider selection).
   */
  private async startConnect(): Promise<void> {
    const serial = navigator.serial;
    if (!serial) {
      console.warn("Web Serial API not available");
      this.core.dropIntent();
      return;
    }
    const granted = await this.findGrantedPort();
    if (granted || loadSavedSerialDevice()) {
      this.port = granted;
      connectionLog.log(
        this.id,
        "connect-attempt",
        `${this.portLabel()} (restored)`,
      );
      try {
        await this.core.runEstablish("restored");
      } catch (err) {
        console.warn("Web Serial restored-device connect failed:", err);
        this.onNotice?.({
          kind: "connect-failed",
          detail:
            err instanceof Error && err.message === NOT_PRESENT
              ? "GPS not plugged in — reconnects when attached"
              : String(err),
        });
        await this.core.noteEstablishFailed(err);
      }
      return;
    }
    await this.pickAndConnect();
  }

  // First connect: show the port chooser (needs a user gesture). A cancelled
  // picker drops the intent — re-opening it would need a fresh gesture.
  private async pickAndConnect(): Promise<void> {
    const serial = navigator.serial;
    if (!serial) {
      this.core.dropIntent();
      return;
    }
    try {
      connectionLog.log(this.id, "picker-shown");
      this.port = await serial.requestPort();
      const info = this.port.getInfo?.() ?? {};
      if (info.usbVendorId !== undefined && info.usbProductId !== undefined) {
        saveSerialDevice({
          vendorId: info.usbVendorId,
          productId: info.usbProductId,
        });
      }
      connectionLog.log(this.id, "device-selected", this.portLabel());
    } catch (err) {
      console.warn("Web Serial device not selected:", err);
      connectionLog.log(this.id, "picker-cancelled", String(err));
      this.onNotice?.({ kind: "picker-cancelled", detail: String(err) });
      this.core.dropIntent();
      return;
    }
    try {
      connectionLog.log(
        this.id,
        "connect-attempt",
        `${this.portLabel()} (initial)`,
      );
      await this.core.runEstablish("initial");
    } catch (err) {
      console.warn("Web Serial connect failed, retrying:", err);
      await this.core.noteEstablishFailed(err);
    }
  }

  /**
   * Re-find the granted port without a gesture: match the saved USB
   * vendor/product ids, or — with nothing saved (e.g. a Bluetooth serial
   * port, which has no USB ids) — reuse a sole granted port.
   */
  private async findGrantedPort(): Promise<SerialPort | null> {
    const serial = navigator.serial;
    if (!serial || typeof serial.getPorts !== "function") return null;
    const ports = await serial.getPorts().catch(() => [] as SerialPort[]);
    const saved = loadSavedSerialDevice();
    if (saved) {
      return (
        ports.find((p) => {
          const info = p.getInfo?.() ?? {};
          return (
            info.usbVendorId === saved.vendorId &&
            info.usbProductId === saved.productId
          );
        }) ?? null
      );
    }
    return ports.length === 1 ? ports[0] : null;
  }

  // Open the port and start the read loop. Used for the initial connect and
  // every reconnect; re-resolves the port so a stale handle from before an
  // unplug is replaced by the freshly-attached one.
  private async openPort(): Promise<void> {
    // A watchdog-forced retry finds the read loop still pumping on the same
    // port (its reader.read() is merely pending on a silent stream, not
    // errored) — tear that down first, or the re-open below throws
    // InvalidStateError against the still-locked port on every retry.
    this.teardownLink();
    const port = this.port ?? (await this.findGrantedPort());
    this.port = null; // stale handles must not survive a failed attempt
    if (!port) throw new Error(NOT_PRESENT);
    await port.close().catch(() => {}); // clear a half-open port
    await port.open({ baudRate: this.baudRate });
    if (!port.readable) throw new Error("port has no readable stream");
    const textDecoder = new TextDecoderStream();
    (port.readable as ReadableStream)
      .pipeTo(textDecoder.writable)
      .catch(() => {});
    const reader = textDecoder.readable.getReader();
    this.port = port;
    this.reader = reader;
    void this.readLoop(port, reader);
  }

  private handleEstablished(): void {
    this.stream.reset();
    connectionLog.log(this.id, "connected", this.portLabel());
    this.onNotice?.({ kind: "connected" });
  }

  // Pump NMEA text until the stream ends. An unplug (or stream error) lands
  // in the finally, where the identity guard separates it from our own
  // teardown — that report is what un-wedges the provider (the old code left
  // `connected` true forever after a device removal).
  private async readLoop(
    port: SerialPort,
    reader: ReadableStreamDefaultReader<string>,
  ): Promise<void> {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          this.core.noteData();
          this.stream.push(value);
        }
      }
    } catch (err) {
      console.warn("Web Serial error:", err);
    } finally {
      if (this.reader === reader) {
        this.reader = null;
        this.port = null;
        port.close().catch(() => {});
        this.core.noteLinkDropped("device");
      }
    }
  }

  // Close the current link quietly: nulling the fields first makes the read
  // loop's identity guard swallow the resulting stream end.
  private teardownLink(): void {
    const reader = this.reader;
    const port = this.port;
    this.reader = null;
    this.port = null;
    reader?.cancel().catch(() => {});
    port?.close().catch(() => {});
  }

  // Idle recovery for an unplugged device: the serial "connect" event fires
  // when a granted port is re-attached — retry immediately, no backoff
  // polling. Returns false if events aren't supported (fall back to backoff).
  private startPortWaitWatch(): boolean {
    const serial = navigator.serial;
    if (
      !serial ||
      typeof serial.addEventListener !== "function" ||
      this.portWatchStop
    ) {
      return false;
    }
    const onConnect = (): void => {
      stop();
      this.core.requestRetry(); // device is back — open should work now
    };
    const stop = (): void => {
      serial.removeEventListener("connect", onConnect);
      this.portWatchStop = null;
      this.core.noteEscalationEnded();
    };
    this.portWatchStop = stop;
    serial.addEventListener("connect", onConnect);
    return true;
  }

  private stopPortWatch(): void {
    this.portWatchStop?.();
  }

  private portLabel(): string {
    const saved = loadSavedSerialDevice();
    return saved ? `usb:${saved.vendorId}:${saved.productId}` : "serial port";
  }
}
