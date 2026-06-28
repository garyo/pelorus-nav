/**
 * Parses NMEA GSV (satellites in view + SNR) and GSA (fix type + DOP + which
 * satellites are used) sentences and assembles them into a SatelliteStatus
 * snapshot for the diagnostics UI.
 *
 * GSV arrives as a sequence of messages per constellation (talker GP/GL/GA/GB…),
 * each carrying up to four satellites; GSA carries the fix type, the PRNs used
 * in the solution, and the DOP figures. A multi-constellation receiver emits
 * several of each per epoch, so the tracker accumulates per talker and unions
 * the results.
 */

import type { SatelliteInfo, SatelliteStatus } from "./NavigationData";
import { validateChecksum } from "./nmea-parser";

/** A satellite as reported by GSV — before GSA tells us if it's `used`. */
type ViewSatellite = Omit<SatelliteInfo, "used">;

interface GSVMessage {
  talker: string;
  totalMessages: number;
  messageNumber: number;
  satellites: ViewSatellite[];
}

interface GSAMessage {
  /** 1 = no fix, 2 = 2D, 3 = 3D. */
  fixType: number;
  usedPrns: number[];
  pdop: number | null;
  hdop: number | null;
  vdop: number | null;
}

// NMEA talker code → human-readable constellation name. GN = combined solution.
const CONSTELLATIONS: Record<string, string> = {
  GP: "GPS",
  GL: "GLONASS",
  GA: "Galileo",
  GB: "BeiDou",
  BD: "BeiDou",
  GQ: "QZSS",
  GI: "NavIC",
  GN: "GNSS",
};

function constellationName(talker: string): string {
  return CONSTELLATIONS[talker] ?? talker;
}

function intOrNull(s: string | undefined): number | null {
  if (!s) return null;
  const v = Number.parseInt(s, 10);
  return Number.isNaN(v) ? null : v;
}

function floatOrNull(s: string | undefined): number | null {
  if (!s) return null;
  const v = Number.parseFloat(s);
  return Number.isNaN(v) ? null : v;
}

/** Parse a $..GSV sentence, or null if it isn't a valid GSV. */
export function parseGSV(sentence: string): GSVMessage | null {
  if (!validateChecksum(sentence)) return null;

  const parts = sentence.split("*")[0].split(",");
  const id = parts[0];
  if (!id.endsWith("GSV")) return null;

  const talker = id.slice(1, 3);
  const totalMessages = intOrNull(parts[1]);
  const messageNumber = intOrNull(parts[2]);
  if (totalMessages === null || messageNumber === null) return null;

  // Satellites come in groups of four fields (prn, elev, azim, snr) starting at
  // index 4. A trailing signalId field (NMEA 4.10+) is a lone field that never
  // forms a full group, so the `i + 3 < length` bound skips it.
  const satellites: ViewSatellite[] = [];
  for (let i = 4; i + 3 < parts.length; i += 4) {
    const prn = intOrNull(parts[i]);
    if (prn === null) continue;
    satellites.push({
      prn,
      elevation: intOrNull(parts[i + 1]),
      azimuth: intOrNull(parts[i + 2]),
      snr: intOrNull(parts[i + 3]),
      constellation: constellationName(talker),
    });
  }

  return { talker, totalMessages, messageNumber, satellites };
}

/** Parse a $..GSA sentence, or null if it isn't a valid GSA. */
export function parseGSA(sentence: string): GSAMessage | null {
  if (!validateChecksum(sentence)) return null;

  const parts = sentence.split("*")[0].split(",");
  const id = parts[0];
  if (!id.endsWith("GSA")) return null;

  const fixType = intOrNull(parts[2]);
  if (fixType === null) return null;

  // Fields 3..14 are the 12 PRN slots used in the solution (blank when unused).
  const usedPrns: number[] = [];
  for (let i = 3; i <= 14; i++) {
    const prn = intOrNull(parts[i]);
    if (prn !== null) usedPrns.push(prn);
  }

  return {
    fixType,
    usedPrns,
    pdop: floatOrNull(parts[15]),
    hdop: floatOrNull(parts[16]),
    vdop: floatOrNull(parts[17]),
  };
}

/**
 * Accumulates a GSV/GSA burst into one coherent SatelliteStatus.
 *
 * A receiver emits its whole constellation set — GPS, GLONASS, Galileo, BeiDou,
 * and per-signal (L1/L5) — as a burst of GSV/GSA sentences several times a
 * second. Surfacing a snapshot per sentence would show the count climbing as the
 * burst arrives (10 → 15 → 20 …). Instead, `ingest` accumulates silently and the
 * caller calls `commitEpoch` once the burst goes quiet, yielding one stable frame.
 */
export class SatelliteTracker {
  // Current-epoch satellites keyed by "constellation prn", so each physical
  // satellite is one row even when it reports on multiple signals.
  private building = new Map<string, ViewSatellite>();
  private usedPrns = new Set<number>();
  private fixType = 1;
  private pdop: number | null = null;
  private hdop: number | null = null;
  private vdop: number | null = null;

  /** Fold one GSV/GSA line into the current epoch. No snapshot is produced. */
  ingest(line: string): void {
    const id = line.split(",")[0];
    if (id.endsWith("GSV")) {
      const msg = parseGSV(line);
      if (msg) this.addSatellites(msg.satellites);
    } else if (id.endsWith("GSA")) {
      const msg = parseGSA(line);
      if (msg) this.addSolution(msg);
    }
  }

  /**
   * Close the epoch: return the assembled snapshot and reset for the next burst.
   * Returns null if nothing was ingested since the last commit, so a quiet gap
   * doesn't blank the display.
   */
  commitEpoch(): SatelliteStatus | null {
    if (this.building.size === 0) return null;
    const satellites: SatelliteInfo[] = [];
    for (const s of this.building.values()) {
      // PRNs can collide across constellations, so `used` is best-effort for the
      // display; the `used` count comes from GSA directly.
      satellites.push({ ...s, used: this.usedPrns.has(s.prn) });
    }
    const status: SatelliteStatus = {
      satellites,
      inView: satellites.length,
      used: this.usedPrns.size,
      fixType: this.fixType,
      pdop: this.pdop,
      hdop: this.hdop,
      vdop: this.vdop,
      timestamp: Date.now(),
    };
    this.reset();
    return status;
  }

  reset(): void {
    this.building = new Map();
    this.usedPrns = new Set();
    this.fixType = 1;
    this.pdop = this.hdop = this.vdop = null;
  }

  private addSatellites(sats: ViewSatellite[]): void {
    for (const sat of sats) {
      const key = `${sat.constellation} ${sat.prn}`;
      const existing = this.building.get(key);
      // Same satellite on two signals (L1/L5): keep the stronger C/N0 so a weak
      // band doesn't mask a good one.
      if (existing && (existing.snr ?? -1) >= (sat.snr ?? -1)) continue;
      this.building.set(key, sat);
    }
  }

  // GSA arrives once per active constellation, so union the used PRNs and take
  // the strongest fix type. DOP is solution-wide.
  private addSolution(msg: GSAMessage): void {
    for (const prn of msg.usedPrns) this.usedPrns.add(prn);
    this.fixType = Math.max(this.fixType, msg.fixType);
    if (msg.pdop !== null) this.pdop = msg.pdop;
    if (msg.hdop !== null) this.hdop = msg.hdop;
    if (msg.vdop !== null) this.vdop = msg.vdop;
  }
}
