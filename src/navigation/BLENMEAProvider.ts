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

  private listeners: NavigationDataCallback[] = [];
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothCharacteristic | null = null;
  private connected = false;
  private readonly decoder = new TextDecoder();
  private readonly stream: NMEAStream;

  private readonly onNotify = (event: Event): void => {
    const value = (event.target as BluetoothCharacteristic).value;
    if (value) this.stream.push(this.decoder.decode(value));
  };

  private readonly onDisconnect = (): void => {
    this.connected = false;
    this.characteristic = null;
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
    if (this.connected) return;
    void this.openDevice();
  }

  disconnect(): void {
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

  private async openDevice(): Promise<void> {
    try {
      const bluetooth = navigator.bluetooth;
      if (!bluetooth) return;

      // Synchronous up to here so the user-gesture activation still holds.
      this.device = await bluetooth.requestDevice({
        filters: [{ services: [NUS_SERVICE] }],
      });
      this.device.addEventListener("gattserverdisconnected", this.onDisconnect);

      const gatt = this.device.gatt;
      if (!gatt) return;
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
    } catch (err) {
      console.warn("BLE GPS error:", err);
      this.connected = false;
    }
  }
}
