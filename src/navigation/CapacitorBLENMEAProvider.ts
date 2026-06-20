/**
 * GPS provider for the BLE NUS pod on native (Capacitor) builds — the Android
 * WebView has no Web Bluetooth, so we use @capacitor-community/bluetooth-le.
 *
 * Mirrors BLENMEAProvider (Web Bluetooth): same Nordic UART Service, same NMEA
 * stream, same id ("ble-nmea") and gesture model (selecting the provider in
 * Settings triggers the native device picker). Only the transport API differs,
 * so main.ts registers this on native and the Web Bluetooth one on the web.
 */

import { BleClient, type BleDevice } from "@capacitor-community/bluetooth-le";
import type {
  NavigationDataCallback,
  NavigationDataProvider,
} from "./NavigationData";
import { NMEAStream } from "./nmea-stream";

// Nordic UART Service UUIDs (lowercase, as the plugin expects).
const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // peripheral → central (notify)

export class CapacitorBLENMEAProvider implements NavigationDataProvider {
  readonly id = "ble-nmea";
  readonly name = "Bluetooth GPS (BLE)";

  // Auto-reconnect backoff: a dropped link is retried without re-showing the
  // picker (reconnecting to an already-chosen deviceId needs no user gesture).
  private static readonly RECONNECT_MIN_MS = 1000;
  private static readonly RECONNECT_MAX_MS = 30000;

  private listeners: NavigationDataCallback[] = [];
  private device: BleDevice | null = null;
  private connected = false;
  private wantConnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = 0;
  private readonly decoder = new TextDecoder();
  private readonly stream: NMEAStream;

  constructor() {
    this.stream = new NMEAStream("ble-nmea", (data) => {
      for (const fn of this.listeners) fn(data);
    });
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
    const id = this.device?.deviceId;
    this.device = null;
    this.stream.reset();
    if (id) {
      BleClient.stopNotifications(id, NUS_SERVICE, NUS_TX).catch(() => {});
      BleClient.disconnect(id).catch(() => {});
    }
  }

  subscribe(callback: NavigationDataCallback): void {
    this.listeners.push(callback);
  }

  unsubscribe(callback: NavigationDataCallback): void {
    const idx = this.listeners.indexOf(callback);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  // First connect: native scan picker (needs the user gesture from selecting
  // this provider). A cancelled/failed picker drops the intent — re-opening it
  // would need a fresh gesture, so we don't auto-retry the picker.
  private async pickAndConnect(): Promise<void> {
    // The picker needs a user gesture; a cancel/failure here can't be retried
    // silently, so drop the intent.
    try {
      await BleClient.initialize();
      this.device = await BleClient.requestDevice({ services: [NUS_SERVICE] });
    } catch (err) {
      console.warn("Capacitor BLE GPS device not selected:", err);
      this.wantConnected = false;
      return;
    }
    // Opening the link can fail transiently (e.g. the peripheral's single
    // client slot is still held by a stale connection). Retry on a backoff
    // rather than giving up — no gesture needed.
    try {
      await this.establish();
    } catch (err) {
      console.warn("Capacitor BLE GPS connect failed, retrying:", err);
      this.scheduleReconnect();
    }
  }

  // Connect + subscribe on the already-chosen deviceId. Used for both the
  // initial connect and every reconnect (no gesture needed).
  private async establish(): Promise<void> {
    const id = this.device?.deviceId;
    if (!id) throw new Error("no device");
    await BleClient.connect(id, () => this.onPeripheralDisconnect());
    await BleClient.startNotifications(id, NUS_SERVICE, NUS_TX, (value) =>
      this.stream.push(this.decoder.decode(value)),
    );
    this.stream.reset();
    this.connected = true;
    this.reconnectDelayMs = 0; // recovered — reset the backoff
  }

  private onPeripheralDisconnect(): void {
    this.connected = false;
    if (this.wantConnected) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.wantConnected || this.reconnectTimer !== null) return;
    this.reconnectDelayMs = this.reconnectDelayMs
      ? Math.min(
          this.reconnectDelayMs * 2,
          CapacitorBLENMEAProvider.RECONNECT_MAX_MS,
        )
      : CapacitorBLENMEAProvider.RECONNECT_MIN_MS;
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
      console.warn("Capacitor BLE GPS reconnect failed:", err);
      this.scheduleReconnect();
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectDelayMs = 0;
  }
}
