/**
 * GPS provider for a BLE peripheral exposing the Nordic UART Service (NUS)
 * and streaming NMEA-0183 sentences — the Pelorus GPS pod / ESP32.
 *
 * Web Bluetooth, so Chrome/Edge only (desktop + Android Chrome; not Safari,
 * not the Android WebView — the packaged app would use a native BLE plugin).
 * Like Web Serial, requestDevice() needs a user gesture; selecting this
 * provider in Settings supplies it, and the browser shows its device chooser.
 */

import type {
  NavigationDataCallback,
  NavigationDataProvider,
} from "./NavigationData";
import { NMEAStream } from "./nmea-stream";

// Nordic UART Service UUIDs (lowercase, as Web Bluetooth expects).
const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // peripheral → central (notify)

// Minimal Web Bluetooth typings — not in the bundled DOM lib, and we only
// touch the handful of members below.
interface BluetoothCharacteristic extends EventTarget {
  startNotifications(): Promise<BluetoothCharacteristic>;
  value?: DataView;
}
interface BluetoothService {
  getCharacteristic(uuid: string): Promise<BluetoothCharacteristic>;
}
interface BluetoothGATT {
  connect(): Promise<BluetoothGATT>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BluetoothService>;
}
interface BluetoothDevice extends EventTarget {
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
}
declare global {
  interface Navigator {
    bluetooth?: Bluetooth;
  }
}

export class BLENMEAProvider implements NavigationDataProvider {
  readonly id = "ble-nmea";
  readonly name = "Bluetooth GPS (BLE)";

  // Auto-reconnect backoff: a dropped link is retried without re-showing the
  // chooser (reconnecting to an already-chosen device needs no user gesture).
  private static readonly RECONNECT_MIN_MS = 1000;
  private static readonly RECONNECT_MAX_MS = 30000;

  private listeners: NavigationDataCallback[] = [];
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothCharacteristic | null = null;
  private connected = false;
  private wantConnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = 0;
  private adWatchStop: (() => void) | null = null;
  private readonly decoder = new TextDecoder();
  private readonly stream: NMEAStream;

  private readonly onNotify = (event: Event): void => {
    const value = (event.target as BluetoothCharacteristic).value;
    if (value) this.stream.push(this.decoder.decode(value));
  };

  private readonly onDisconnect = (): void => {
    this.connected = false;
    this.characteristic?.removeEventListener(
      "characteristicvaluechanged",
      this.onNotify,
    );
    this.characteristic = null;
    // The peripheral (or radio) dropped the link — keep the device reference
    // and retry on a backoff so the user doesn't have to re-pick.
    if (this.wantConnected) this.scheduleReconnect();
  };

  constructor() {
    this.stream = new NMEAStream("ble-nmea", (data) => {
      for (const fn of this.listeners) fn(data);
    });
  }

  static isAvailable(): boolean {
    return typeof navigator !== "undefined" && "bluetooth" in navigator;
  }

  isConnected(): boolean {
    return this.connected;
  }

  connect(): void {
    if (this.wantConnected) return;
    this.wantConnected = true;
    void this.pickAndConnect();
  }

  disconnect(): void {
    this.wantConnected = false;
    this.clearReconnect();
    this.connected = false;
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
    this.stream.reset();
  }

  subscribe(callback: NavigationDataCallback): void {
    this.listeners.push(callback);
  }

  unsubscribe(callback: NavigationDataCallback): void {
    const idx = this.listeners.indexOf(callback);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  // First connect: show the chooser (needs the user gesture from selecting this
  // provider) and open the link. A cancelled/failed picker drops the intent —
  // re-opening the chooser would need a fresh gesture, so we don't auto-retry it.
  private async pickAndConnect(): Promise<void> {
    const bluetooth = navigator.bluetooth;
    if (!bluetooth) {
      this.wantConnected = false;
      return;
    }
    // The picker needs a user gesture; a cancel/failure here can't be retried
    // silently, so drop the intent.
    try {
      this.device = await bluetooth.requestDevice({
        filters: [{ services: [NUS_SERVICE] }],
      });
    } catch (err) {
      console.warn("BLE GPS device not selected:", err);
      this.wantConnected = false;
      return;
    }
    this.device.addEventListener("gattserverdisconnected", this.onDisconnect);
    // Opening the link can fail transiently (e.g. the peripheral's single
    // client slot is still held by a stale connection that's about to time
    // out). Retry on a backoff rather than giving up — no gesture needed.
    try {
      await this.establish();
    } catch (err) {
      console.warn("BLE GPS connect failed, retrying:", err);
      this.scheduleReconnect();
    }
  }

  // Open GATT + subscribe to notifications on the already-chosen device. Used
  // for both the initial connect and every reconnect (no gesture needed).
  private async establish(): Promise<void> {
    const gatt = this.device?.gatt;
    if (!gatt) throw new Error("no GATT server");
    const server = await gatt.connect();
    const service = await server.getPrimaryService(NUS_SERVICE);
    this.characteristic = await service.getCharacteristic(NUS_TX);
    this.characteristic.addEventListener(
      "characteristicvaluechanged",
      this.onNotify,
    );
    await this.characteristic.startNotifications();
    this.stream.reset();
    this.connected = true;
    this.reconnectDelayMs = 0; // recovered — reset the backoff
  }

  private scheduleReconnect(): void {
    if (!this.wantConnected || this.reconnectTimer !== null || this.adWatchStop)
      return;
    this.reconnectDelayMs = this.reconnectDelayMs
      ? Math.min(this.reconnectDelayMs * 2, BLENMEAProvider.RECONNECT_MAX_MS)
      : BLENMEAProvider.RECONNECT_MIN_MS;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, this.reconnectDelayMs);
  }

  private async reconnect(): Promise<void> {
    if (!this.wantConnected || !this.device) return;
    try {
      await this.establish();
    } catch (err) {
      console.warn("BLE GPS reconnect failed:", err);
      // A blind gatt.connect() fails fast once the device has left Chrome's
      // range cache (it won't re-scan). Wait for it to advertise again if the
      // browser supports that; otherwise keep polling on the backoff.
      if (!this.startAdvertisementWatch()) this.scheduleReconnect();
    }
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
      void this.reconnect(); // device is back in range — connect should work now
    };
    const stop = (): void => {
      device.removeEventListener("advertisementreceived", onAdvertisement);
      controller.abort();
      this.adWatchStop = null;
    };
    this.adWatchStop = stop;
    device.addEventListener("advertisementreceived", onAdvertisement);
    device.watchAdvertisements({ signal: controller.signal }).catch((err) => {
      console.warn("BLE GPS watchAdvertisements unavailable:", err);
      stop();
      this.scheduleReconnect(); // fall back to polling
    });
    return true;
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.adWatchStop?.();
    this.reconnectDelayMs = 0;
  }
}
