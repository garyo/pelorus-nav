/**
 * GPS provider using Web Serial API for USB/Bluetooth NMEA GPS devices.
 * Only available in Chrome/Edge (requires navigator.serial).
 */

import type {
  NavigationData,
  NavigationDataCallback,
  NavigationDataProvider,
} from "./NavigationData";
import { parseNMEA } from "./nmea-parser";

// Extend Navigator type for Web Serial API
interface SerialPort {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
}

interface Serial {
  requestPort(): Promise<SerialPort>;
}

declare global {
  interface Navigator {
    serial?: Serial;
  }
}

export class WebSerialNMEAProvider implements NavigationDataProvider {
  readonly id = "web-serial";
  readonly name = "USB GPS (Serial)";

  private listeners: NavigationDataCallback[] = [];
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private connected = false;
  private baudRate: number;
  private lastCog: number | null = null;
  private lastSog: number | null = null;

  constructor(baudRate = 4800) {
    this.baudRate = baudRate;
  }

  static isAvailable(): boolean {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  isConnected(): boolean {
    return this.connected;
  }

  connect(): void {
    if (this.connected) return;
    if (!WebSerialNMEAProvider.isAvailable()) {
      console.warn("Web Serial API not available");
      return;
    }
    this.startReading();
  }

  disconnect(): void {
    this.connected = false;
    this.reader?.cancel().catch(() => {});
    this.port?.close().catch(() => {});
    this.reader = null;
    this.port = null;
  }

  subscribe(callback: NavigationDataCallback): void {
    this.listeners.push(callback);
  }

  unsubscribe(callback: NavigationDataCallback): void {
    const idx = this.listeners.indexOf(callback);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  private async startReading(): Promise<void> {
    try {
      const serial = navigator.serial;
      if (!serial) return;
      this.port = await serial.requestPort();
      await this.port.open({ baudRate: this.baudRate });
      this.connected = true;

      if (!this.port.readable) return;

      const textDecoder = new TextDecoderStream();
      (this.port.readable as ReadableStream)
        .pipeTo(textDecoder.writable)
        .catch(() => {});

      this.reader = textDecoder.readable.getReader();
      let buffer = "";

      while (this.connected) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value) continue;

        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          this.processLine(line.trim());
        }
      }
    } catch (err) {
      console.warn("Web Serial error:", err);
      this.connected = false;
    }
  }

  private processLine(line: string): void {
    if (!line.startsWith("$")) return;

    const parsed = parseNMEA(line);
    if (!parsed) return;

    // RMC provides COG/SOG, GGA provides altitude/accuracy
    // Track last known COG/SOG for merging
    if (parsed.cog !== null) this.lastCog = parsed.cog;
    if (parsed.sog !== null) this.lastSog = parsed.sog;

    const data: NavigationData = {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      cog: parsed.cog ?? this.lastCog,
      sog: parsed.sog ?? this.lastSog,
      heading: null,
      accuracy: parsed.accuracy,
      timestamp: parsed.timestamp,
      source: "web-serial",
    };

    for (const fn of this.listeners) {
      fn(data);
    }
  }
}
