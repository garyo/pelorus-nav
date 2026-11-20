/**
 * What the instrument panel showed over the last few minutes, exactly as
 * displayed ("~" marks a provisional time), so a bug report about a wrong
 * reading shows the reading. One line per change, in memory only: shipped
 * in bug reports as the INSTRUMENT PANEL section.
 */

/** Span of panel readings kept. */
export const INSTRUMENT_WINDOW_MS = 15 * 60_000;
/** Bound on lines kept whatever the update rate (4 Hz for 15 min). */
const MAX_LINES = 3600;

interface Reading {
  t: number;
  text: string;
}

export class InstrumentLog {
  private readings: Reading[] = [];

  /** Record the panel's text, if it differs from the last reading. */
  record(text: string, now = Date.now()): void {
    if (this.readings.at(-1)?.text === text) return;
    this.readings.push({ t: now, text });
    const cutoff = now - INSTRUMENT_WINDOW_MS;
    let drop = this.readings.findIndex((r) => r.t >= cutoff);
    if (drop < 0) drop = this.readings.length;
    drop = Math.max(drop, this.readings.length - MAX_LINES);
    if (drop > 0) this.readings.splice(0, drop);
  }

  get entryCount(): number {
    return this.readings.length;
  }

  /** The last `lastN` readings, one "ISO-time  text" line each. */
  toText(lastN?: number): string {
    const rows = lastN ? this.readings.slice(-lastN) : this.readings;
    return rows
      .map((r) => `${new Date(r.t).toISOString()}  ${r.text}`)
      .join("\n");
  }
}

export const instrumentLog = new InstrumentLog();
