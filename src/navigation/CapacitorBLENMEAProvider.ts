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

  private listeners: NavigationDataCallback[] = [];
  private device: BleDevice | null = null;
  private connected = false;
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
    if (this.connected) return;
    void this.openDevice();
  }

  disconnect(): void {
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

  private async openDevice(): Promise<void> {
    try {
      await BleClient.initialize();
      // Native scan picker — needs a user gesture (provider selection supplies it).
      this.device = await BleClient.requestDevice({ services: [NUS_SERVICE] });
      await BleClient.connect(this.device.deviceId, () => {
        // Peripheral dropped the link.
        this.connected = false;
      });
      this.stream.reset();
      await BleClient.startNotifications(
        this.device.deviceId,
        NUS_SERVICE,
        NUS_TX,
        (value) => this.stream.push(this.decoder.decode(value)),
      );
      this.connected = true;
    } catch (err) {
      console.warn("Capacitor BLE GPS error:", err);
      this.connected = false;
    }
  }
}
