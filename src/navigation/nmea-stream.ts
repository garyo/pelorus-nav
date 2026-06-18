/**
 * Shared NMEA-0183 stream assembler for byte-stream GPS providers
 * (Web Serial, BLE NUS). Buffers partial lines across chunks, parses each
 * complete sentence, and carries forward the last known COG/SOG — RMC carries
 * them but GGA does not, so a GGA-only update reuses the most recent values.
 */

import type { NavigationData } from "./NavigationData";
import { parseNMEA } from "./nmea-parser";

export class NMEAStream {
  private buffer = "";
  private lastCog: number | null = null;
  private lastSog: number | null = null;
  private readonly source: string;
  private readonly onFix: (data: NavigationData) => void;

  constructor(source: string, onFix: (data: NavigationData) => void) {
    this.source = source;
    this.onFix = onFix;
  }

  /** Feed a chunk of decoded text; may contain partial and/or multiple lines. */
  push(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) this.processLine(line.trim());
  }

  /** Drop the buffered partial line and carried-forward COG/SOG. */
  reset(): void {
    this.buffer = "";
    this.lastCog = null;
    this.lastSog = null;
  }

  private processLine(line: string): void {
    if (!line.startsWith("$")) return;

    const parsed = parseNMEA(line);
    if (!parsed) return;

    if (parsed.cog !== null) this.lastCog = parsed.cog;
    if (parsed.sog !== null) this.lastSog = parsed.sog;

    this.onFix({
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      cog: parsed.cog ?? this.lastCog,
      sog: parsed.sog ?? this.lastSog,
      heading: null,
      accuracy: parsed.accuracy,
      timestamp: parsed.timestamp,
      source: this.source,
    });
  }
}
