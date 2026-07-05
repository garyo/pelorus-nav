/**
 * GPS provider for a BLE peripheral exposing the Nordic UART Service (NUS)
 * and streaming NMEA-0183 sentences — the Pelorus GPS pod / ESP32.
 *
 * Web Bluetooth, so Chrome/Edge only (desktop + Android Chrome; not Safari,
 * not the Android WebView — the packaged app would use a native BLE plugin).
 * Like Web Serial, requestDevice() needs a user gesture; selecting this
 * provider in Settings supplies it, and the browser shows its device chooser.
 *
 * The reconnect state machine (intent, backoff, silence watchdog) lives in
 * ReconnectingTransport; this class owns the Web Bluetooth transport and the
 * acquisition flows (chooser, getDevices rehydrate, advertisement watch).
 */

import {
  clearSavedBleDevice,
  loadSavedBleDevice,
  saveBleDevice,
} from "./bleDeviceStore";
import { connectionLog } from "./ConnectionEventLog";
import type {
  NavigationDataCallback,
  NavigationDataProvider,
  SatelliteDiagnostics,
  SatelliteStatusCallback,
} from "./NavigationData";
import { NMEAStream } from "./nmea-stream";
import type { ProviderNotice } from "./ProviderNotice";
import { ReconnectingTransport } from "./ReconnectingTransport";

// Nordic UART Service UUIDs (lowercase, as Web Bluetooth expects).
const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // central → peripheral (write)
const NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // peripheral → central (notify)

// Minimal Web Bluetooth typings — not in the bundled DOM lib, and we only
// touch the handful of members below.
interface BluetoothCharacteristic extends EventTarget {
  startNotifications(): Promise<BluetoothCharacteristic>;
  writeValueWithResponse?(value: BufferSource): Promise<void>;
  writeValue?(value: BufferSource): Promise<void>;
  value?: DataView;
}
interface BluetoothService {
  getCharacteristic(uuid: string): Promise<BluetoothCharacteristic>;
}
interface BluetoothGATT {
  connected?: boolean;
  connect(): Promise<BluetoothGATT>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BluetoothService>;
}
interface BluetoothDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BluetoothGATT;
  // Optional — lets us recover after the device has left Chrome's range cache
  // (gated/absent in some browsers, so feature-detected before use).
  watchAdvertisements?(options?: { signal?: AbortSignal }): Promise<void>;
}
interface Bluetooth {
  requestDevice(options: {
    filters?: Array<{ services?: string[]; namePrefix?: string }>;
    optionalServices?: string[];
  }): Promise<BluetoothDevice>;
  // Permission-gated and not universally shipped — feature-detect before use.
  getDevices?(): Promise<BluetoothDevice[]>;
}
declare global {
  interface Navigator {
    bluetooth?: Bluetooth;
  }
}

export class BLENMEAProvider
  implements NavigationDataProvider, SatelliteDiagnostics
{
  readonly id = "ble-nmea";
  readonly name = "Bluetooth GPS (BLE)";

  private listeners: NavigationDataCallback[] = [];
  private satListeners: SatelliteStatusCallback[] = [];
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothCharacteristic | null = null;
  private rxCharacteristic: BluetoothCharacteristic | null = null;
  // The GATT link the last successful establish opened — what teardown must
  // close when disconnect() raced the establish (this.device may be gone).
  private activeGatt: BluetoothGATT | null = null;
  private satWanted = false;
  private adWatchStop: (() => void) | null = null;
  private readonly core: ReconnectingTransport;
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();
  private readonly stream: NMEAStream;

  private readonly onNotify = (event: Event): void => {
    const value = (event.target as BluetoothCharacteristic).value;
    if (value) {
      this.core.noteData();
      this.stream.push(this.decoder.decode(value));
    }
  };

  private readonly onDisconnect = (): void => {
    // The peripheral (or radio) dropped the link — the core keeps the device
    // reference usable and retries on a backoff so the user doesn't re-pick.
    if (!this.core.noteLinkDropped()) return; // our own teardown during (re)connect
    this.characteristic?.removeEventListener(
      "characteristicvaluechanged",
      this.onNotify,
    );
    this.characteristic = null;
  };

  private readonly onNotice?: (notice: ProviderNotice) => void;

  constructor(onNotice?: (notice: ProviderNotice) => void) {
    this.onNotice = onNotice;
    this.stream = new NMEAStream(
      "ble-nmea",
      (data) => {
        for (const fn of this.listeners) fn(data);
      },
      (status) => {
        for (const fn of this.satListeners) fn(status);
      },
    );
    this.core = new ReconnectingTransport(
      { providerId: this.id, logLabel: "BLE GPS" },
      {
        establish: () => this.openLink(),
        onEstablished: () => this.handleEstablished(),
        teardown: () => this.teardownLink(),
        canAttempt: () => this.device !== null,
        escalateRecovery: () => this.startAdvertisementWatch(),
      },
    );
  }

  static isAvailable(): boolean {
    return typeof navigator !== "undefined" && "bluetooth" in navigator;
  }

  isConnected(): boolean {
    return this.core.isConnected();
  }

  isReconnecting(): boolean {
    return this.core.isReconnecting();
  }

  /** Background pacing: stretch reconnect delays while hidden and not recording. */
  setReconnectPacing(relaxed: boolean): void {
    this.core.setPacing(relaxed);
  }

  connect(): void {
    if (!this.core.noteConnectRequested()) return;
    void this.startConnect();
  }

  disconnect(): void {
    this.stopAdWatch();
    this.core.noteDisconnectRequested();
    this.characteristic?.removeEventListener(
      "characteristicvaluechanged",
      this.onNotify,
    );
    this.device?.removeEventListener(
      "gattserverdisconnected",
      this.onDisconnect,
    );
    this.device?.gatt?.disconnect();
    this.device = null;
    this.characteristic = null;
    this.rxCharacteristic = null;
    this.activeGatt = null;
    this.stream.reset();
  }

  /**
   * Manual reconnect (UI button). Tries the already-chosen device first (no
   * picker); if that fails — e.g. the device has left Chrome's range cache —
   * falls back to the chooser while the click's activation is still valid, so
   * the button always gets you connected.
   */
  async reconnect(): Promise<void> {
    this.stopAdWatch();
    this.core.claimIntent();
    if (this.device) {
      try {
        await this.core.runEstablish("manual"); // reuse the chosen device — no chooser
        return;
      } catch (err) {
        console.warn(
          "BLE GPS manual reconnect: reuse failed, re-picking:",
          err,
        );
        this.device.removeEventListener(
          "gattserverdisconnected",
          this.onDisconnect,
        );
        this.device = null;
      }
    }
    await this.pickAndConnect(); // shows the chooser (device is pre-listed)
  }

  subscribe(callback: NavigationDataCallback): void {
    this.listeners.push(callback);
  }

  unsubscribe(callback: NavigationDataCallback): void {
    const idx = this.listeners.indexOf(callback);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  requestSatelliteData(enable: boolean): void {
    this.satWanted = enable;
    this.sendSatCommand(enable);
  }

  subscribeSatelliteStatus(callback: SatelliteStatusCallback): void {
    this.satListeners.push(callback);
  }

  unsubscribeSatelliteStatus(callback: SatelliteStatusCallback): void {
    const idx = this.satListeners.indexOf(callback);
    if (idx >= 0) this.satListeners.splice(idx, 1);
  }

  // Tell the pod to start/stop streaming GSV/GSA. No-op (logged) if the link is
  // down or the firmware has no RX characteristic — the pod also auto-reverts.
  private sendSatCommand(enable: boolean): void {
    const c = this.rxCharacteristic;
    if (!c) return;
    const data = this.encoder.encode(`SAT ${enable ? 1 : 0}\n`);
    const write = c.writeValueWithResponse ?? c.writeValue;
    write?.call(c, data).catch((err) => {
      console.warn("BLE GPS satellite command failed:", err);
    });
  }

  /** Forget the saved pod and re-run the chooser (needs a user gesture). */
  async pickNewDevice(): Promise<void> {
    clearSavedBleDevice();
    this.stopAdWatch();
    this.characteristic?.removeEventListener(
      "characteristicvaluechanged",
      this.onNotify,
    );
    this.device?.removeEventListener(
      "gattserverdisconnected",
      this.onDisconnect,
    );
    this.device?.gatt?.disconnect();
    this.device = null;
    this.characteristic = null;
    this.rxCharacteristic = null;
    this.activeGatt = null;
    this.core.claimIntent();
    await this.pickAndConnect();
  }

  /**
   * Full connect flow: saved-device rehydrate via bluetooth.getDevices()
   * (silent, closes the cross-page-reload reconnect gap), falling back to the
   * chooser. With a saved device but no getDevices support, surface a notice —
   * requestDevice without a gesture would just throw a SecurityError.
   */
  private async startConnect(): Promise<void> {
    const bluetooth = navigator.bluetooth;
    if (!bluetooth) {
      this.core.dropIntent();
      return;
    }
    const saved = loadSavedBleDevice();
    if (saved) {
      if (typeof bluetooth.getDevices === "function") {
        const devices = await bluetooth
          .getDevices()
          .catch(() => [] as BluetoothDevice[]);
        const match = devices.find((d) => d.id === saved.deviceId);
        if (match) {
          this.device = match;
          this.device.addEventListener(
            "gattserverdisconnected",
            this.onDisconnect,
          );
          connectionLog.log(
            this.id,
            "connect-attempt",
            `${saved.deviceId} (restored)`,
          );
          try {
            await this.core.runEstablish("restored");
          } catch (err) {
            console.warn("BLE GPS restored-device connect failed:", err);
            await this.core.noteEstablishFailed(err);
          }
          return;
        }
      }
      // Saved device not reachable without a gesture — tell the user how to
      // resume (the banner's Retry click supplies the gesture reconnect needs).
      connectionLog.log(this.id, "error", "saved device needs a gesture");
      this.onNotice?.({
        kind: "connect-failed",
        detail: "tap Retry to reconnect to the GPS pod",
      });
      return;
    }
    await this.pickAndConnect();
  }

  // First connect: show the chooser (needs the user gesture from selecting this
  // provider) and open the link. A cancelled/failed picker drops the intent —
  // re-opening the chooser would need a fresh gesture, so we don't auto-retry it.
  private async pickAndConnect(): Promise<void> {
    const bluetooth = navigator.bluetooth;
    if (!bluetooth) {
      this.core.dropIntent();
      return;
    }
    // The picker needs a user gesture; a cancel/failure here can't be retried
    // silently, so drop the intent — but loudly (log + notice).
    try {
      connectionLog.log(this.id, "picker-shown");
      this.device = await bluetooth.requestDevice({
        filters: [{ services: [NUS_SERVICE] }],
      });
      saveBleDevice({ deviceId: this.device.id, name: this.device.name });
      connectionLog.log(
        this.id,
        "device-selected",
        `${this.device.name ?? "?"} ${this.device.id}`,
      );
    } catch (err) {
      console.warn("BLE GPS device not selected:", err);
      connectionLog.log(this.id, "picker-cancelled", String(err));
      this.onNotice?.({ kind: "picker-cancelled", detail: String(err) });
      this.core.dropIntent();
      return;
    }
    this.device.addEventListener("gattserverdisconnected", this.onDisconnect);
    // Opening the link can fail transiently (e.g. the peripheral's single
    // client slot is still held by a stale connection that's about to time
    // out). Retry on a backoff rather than giving up — no gesture needed.
    try {
      connectionLog.log(
        this.id,
        "connect-attempt",
        `${this.device.id} (initial)`,
      );
      await this.core.runEstablish("initial");
    } catch (err) {
      console.warn("BLE GPS connect failed, retrying:", err);
      this.core.scheduleReconnect();
    }
  }

  // Open GATT + subscribe to notifications on the already-chosen device. Used
  // for both the initial connect and every reconnect (no gesture needed).
  private async openLink(): Promise<void> {
    const gatt = this.device?.gatt;
    if (!gatt) throw new Error("no GATT server");
    // Drop any prior characteristic listener before re-subscribing on reconnect.
    this.characteristic?.removeEventListener(
      "characteristicvaluechanged",
      this.onNotify,
    );
    // Clear a half-open link so we reconnect from a clean slate (a pod reboot
    // can leave gatt.connect() resolving on a dead handle). The core's
    // establishing guard keeps the resulting disconnect event from triggering
    // our reconnect path.
    if (gatt.connected) gatt.disconnect();
    const server = await gatt.connect();
    const service = await server.getPrimaryService(NUS_SERVICE);
    this.characteristic = await service.getCharacteristic(NUS_TX);
    this.characteristic.addEventListener(
      "characteristicvaluechanged",
      this.onNotify,
    );
    await this.characteristic.startNotifications();
    // RX (write) is optional — older pod firmware has no command channel, so a
    // missing characteristic just leaves satellite diagnostics unavailable.
    try {
      this.rxCharacteristic = await service.getCharacteristic(NUS_RX);
    } catch {
      this.rxCharacteristic = null;
    }
    this.activeGatt = gatt;
  }

  private handleEstablished(): void {
    this.stream.reset();
    connectionLog.log(this.id, "connected", this.device?.name ?? undefined);
    this.onNotice?.({ kind: "connected" });
    // Re-arm satellite forwarding if a diagnostics view is open across a reconnect.
    if (this.satWanted) this.sendSatCommand(true);
  }

  // Close the link the establish just opened (the intent was dropped while it
  // was awaited — leaking it would hold the pod's single client slot).
  private teardownLink(): void {
    this.characteristic?.removeEventListener(
      "characteristicvaluechanged",
      this.onNotify,
    );
    this.characteristic = null;
    this.rxCharacteristic = null;
    this.activeGatt?.disconnect();
    this.activeGatt = null;
  }

  // Recover from a longer outage: ask the browser to watch for the device to
  // advertise again, then connect. Returns false if unsupported (caller falls
  // back to backoff polling). Event-driven, so no busy-wait.
  private startAdvertisementWatch(): boolean {
    const device = this.device;
    if (
      !device ||
      typeof device.watchAdvertisements !== "function" ||
      this.adWatchStop
    ) {
      return false;
    }
    const controller = new AbortController();
    const onAdvertisement = (): void => {
      stop();
      this.core.requestRetry(); // back in range — connect should work now
    };
    const stop = (): void => {
      device.removeEventListener("advertisementreceived", onAdvertisement);
      controller.abort();
      this.adWatchStop = null;
      this.core.noteEscalationEnded();
    };
    this.adWatchStop = stop;
    device.addEventListener("advertisementreceived", onAdvertisement);
    device.watchAdvertisements({ signal: controller.signal }).catch((err) => {
      console.warn("BLE GPS watchAdvertisements unavailable:", err);
      stop();
      this.core.scheduleReconnect(); // fall back to polling
    });
    return true;
  }

  private stopAdWatch(): void {
    this.adWatchStop?.();
  }
}
