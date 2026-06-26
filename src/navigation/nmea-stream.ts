/**
 * Shared NMEA-0183 stream assembler for byte-stream GPS providers
 * (Web Serial, BLE NUS). Buffers partial lines across chunks, parses each
 * complete sentence, and coalesces the sentences of one GPS epoch into a
 * single fix.
 *
 * A GPS chip emits several sentences per 1 Hz epoch — typically RMC (carries
 * SOG/COG) and GGA (carries accuracy/HDOP) — all sharing the same time-of-fix.
 * They describe one fix, so we merge them: RMC contributes velocity, GGA
 * contributes accuracy, and the position agrees. Emitting them separately
 * would hand the downstream filter two fixes with an identical timestamp
 * (dt = 0), which it can't smooth. The last known COG/SOG carry forward so an
 * epoch with only a GGA reuses the most recent values.
 */

import type { NavigationData } from "./NavigationData";
import { parseNMEA } from "./nmea-parser";

interface PendingFix {
  timestamp: number;
  latitude: number;
  longitude: number;
  cog: number | null;
  sog: number | null;
  accuracy: number | null;
}

export class NMEAStream {
  private buffer = "";
  private lastCog: number | null = null;
  private lastSog: number | null = null;
  private pending: PendingFix | null = null;
  private pendingHasRMC = false;
  private pendingHasGGA = false;
  private lastEmittedTimestamp: number | null = null;
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

  /** Drop the buffered partial line, pending epoch, and carried COG/SOG. */
  reset(): void {
    this.buffer = "";
    this.lastCog = null;
    this.lastSog = null;
    this.pending = null;
    this.pendingHasRMC = false;
    this.pendingHasGGA = false;
    this.lastEmittedTimestamp = null;
  }

  private processLine(line: string): void {
    if (!line.startsWith("$")) return;

    const parsed = parseNMEA(line);
    if (!parsed) return;

    // A straggler sentence for an epoch we already emitted (e.g. a third
    // sentence type after RMC+GGA flushed). Ignore — the fix is already out.
    if (!this.pending && parsed.timestamp === this.lastEmittedTimestamp) return;

    // A sentence with a new time-of-fix starts a new epoch — emit the
    // buffered one first so a still-incomplete epoch isn't held forever.
    if (this.pending && parsed.timestamp !== this.pending.timestamp) {
      this.flush();
    }

    if (!this.pending) {
      this.pending = {
        timestamp: parsed.timestamp,
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        cog: parsed.cog,
        sog: parsed.sog,
        accuracy: parsed.accuracy,
      };
    } else {
      // Merge into the epoch: last non-null value wins, so RMC's COG/SOG and
      // GGA's accuracy both survive regardless of arrival order.
      this.pending.latitude = parsed.latitude;
      this.pending.longitude = parsed.longitude;
      if (parsed.cog !== null) this.pending.cog = parsed.cog;
      if (parsed.sog !== null) this.pending.sog = parsed.sog;
      if (parsed.accuracy !== null) this.pending.accuracy = parsed.accuracy;
    }

    if (line.split(",")[0].endsWith("RMC")) this.pendingHasRMC = true;
    else this.pendingHasGGA = true;

    // Both sentences of the epoch are in — emit now rather than waiting for the
    // next epoch's first sentence, which would add ~1 s of latency.
    if (this.pendingHasRMC && this.pendingHasGGA) this.flush();
  }

  private flush(): void {
    const p = this.pending;
    if (!p) return;

    if (p.cog !== null) this.lastCog = p.cog;
    if (p.sog !== null) this.lastSog = p.sog;

    this.onFix({
      latitude: p.latitude,
      longitude: p.longitude,
      cog: p.cog ?? this.lastCog,
      sog: p.sog ?? this.lastSog,
      heading: null,
      accuracy: p.accuracy,
      timestamp: p.timestamp,
      source: this.source,
    });

    this.lastEmittedTimestamp = p.timestamp;
    this.pending = null;
    this.pendingHasRMC = false;
    this.pendingHasGGA = false;
  }
}
