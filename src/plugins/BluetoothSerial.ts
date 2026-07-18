/**
 * Capacitor plugin interface for the native Bluetooth Classic SPP transport
 * (android/.../plugins/btserial/BluetoothSerialPlugin.kt). Used by
 * CapacitorSPPNMEAProvider for NMEA receivers like the Garmin GLO that speak
 * the Serial Port Profile rather than BLE.
 *
 * Classic devices are paired in Android's Bluetooth settings, so there is no
 * scan/picker method — the app lists bonded devices and connects by MAC.
 */

import { type PluginListenerHandle, registerPlugin } from "@capacitor/core";

export interface SPPDevice {
  /** MAC address — stable across sessions for bonded Classic devices. */
  deviceId: string;
  name: string;
}

export interface BluetoothSerialPlugin {
  isEnabled(): Promise<{ enabled: boolean }>;
  /** Bonded Classic/dual-mode devices (BLE-only peripherals are excluded). */
  getBondedDevices(): Promise<{ devices: SPPDevice[] }>;
  /** Open the RFCOMM link; resolves once the socket is connected. */
  connect(options: { deviceId: string }): Promise<void>;
  disconnect(): Promise<void>;
  addListener(
    eventName: "data",
    listener: (event: { data: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "disconnected",
    listener: () => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

export const BluetoothSerial =
  registerPlugin<BluetoothSerialPlugin>("BluetoothSerial");
