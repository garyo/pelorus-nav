/**
 * Diagnostic logger for the GPS filtering pipeline.
 * Records raw, Kalman-filtered, and smoothed data at each stage
 * for offline analysis. Data is stored in memory and can be
 * exported as CSV via the downloadFile utility.
 *
 * Two stores: the last RECENT_WINDOW_MS of fixes are always kept, so a bug
 * report carries what led up to it; a recording (start()/stop(), from the
 * console) keeps up to MAX_ENTRIES for longer analysis.
 */

interface GPSLogEntry {
  timestamp: number;
  // Raw from GPS hardware
  rawLat: number;
  rawLon: number;
  rawSog: number | null;
  rawCog: number | null;
  rawAccuracy: number | null;
  // After Kalman filter
  filteredLat: number;
  filteredLon: number;
  filteredSog: number | null;
  filteredCog: number | null;
  // After CourseSmoothing
  smoothedSog: number | null;
  smoothedCog: number | null;
  // Adaptive rate state
  adaptiveTier: string;
  adaptiveIntervalMs: number;
  // Was this fix broadcast to UI?
  broadcast: boolean;
  // GPS quality score in [0, 1] (0=good, 1=jittery). Drives filter strength.
  qualityScore: number;
  // Passage-average SOG (knots) feeding ETAs, whether it is still settling
  // after a speed change, and whether ETAs from it are shown as provisional.
  avgSog: number | null;
  avgSettling: boolean;
  avgProvisional: boolean;
}

const MAX_ENTRIES = 10_000; // ~5.5 hours at 2s intervals
/** Span of fixes always kept for bug reports. */
export const RECENT_WINDOW_MS = 15 * 60_000;
/** Bound on that store whatever the fix rate (4 Hz for 15 min). */
const RECENT_MAX_ENTRIES = 3600;

export class GPSDiagnosticLog {
  /** The recording (start()/stop()). */
  private entries: GPSLogEntry[] = [];
  /** The last RECENT_WINDOW_MS of fixes, always kept. */
  private recent: GPSLogEntry[] = [];
  private _enabled = false;
  private currentEntry: Partial<GPSLogEntry> | null = null;

  get enabled(): boolean {
    return this._enabled;
  }

  start(): void {
    this._enabled = true;
    this.entries = [];
    console.log("GPSDiagnosticLog: started");
  }

  stop(): void {
    this._enabled = false;
    console.log(`GPSDiagnosticLog: stopped, ${this.entries.length} entries`);
  }

  get entryCount(): number {
    return this.entries.length;
  }

  get recentCount(): number {
    return this.recent.length;
  }

  /** Stage 1: Record raw GPS fix (before Kalman filter). */
  logRaw(
    timestamp: number,
    lat: number,
    lon: number,
    sog: number | null,
    cog: number | null,
    accuracy: number | null,
  ): void {
    this.currentEntry = {
      timestamp,
      rawLat: lat,
      rawLon: lon,
      rawSog: sog,
      rawCog: cog,
      rawAccuracy: accuracy,
    };
  }

  /** Stage 2: Record Kalman-filtered output. */
  logFiltered(
    lat: number,
    lon: number,
    sog: number | null,
    cog: number | null,
  ): void {
    if (!this.currentEntry) return;
    this.currentEntry.filteredLat = lat;
    this.currentEntry.filteredLon = lon;
    this.currentEntry.filteredSog = sog;
    this.currentEntry.filteredCog = cog;
  }

  /** Stage 3: Record adaptive rate state and broadcast decision. */
  logAdaptive(tier: string, intervalMs: number, broadcast: boolean): void {
    if (!this.currentEntry) return;
    this.currentEntry.adaptiveTier = tier;
    this.currentEntry.adaptiveIntervalMs = intervalMs;
    this.currentEntry.broadcast = broadcast;
  }

  /** Record the GPS quality score used for this fix. */
  logQuality(q: number): void {
    if (!this.currentEntry) return;
    this.currentEntry.qualityScore = q;
  }

  /** Record the passage-average speed state after this fix. */
  logAverage(
    avgSog: number | null,
    settling: boolean,
    provisional: boolean,
  ): void {
    if (!this.currentEntry) return;
    this.currentEntry.avgSog = avgSog;
    this.currentEntry.avgSettling = settling;
    this.currentEntry.avgProvisional = provisional;
  }

  /** Stage 4: Record course-smoothed output (called on broadcast only). */
  logSmoothed(sog: number | null, cog: number | null): void {
    if (!this.currentEntry) return;
    this.currentEntry.smoothedSog = sog;
    this.currentEntry.smoothedCog = cog;
  }

  /** Finalize the current entry and add it to the stores. */
  commit(): void {
    if (!this.currentEntry) return;
    const entry = this.currentEntry as GPSLogEntry;
    this.currentEntry = null;
    if (this._enabled) {
      this.entries.push(entry);
      if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    }
    this.recent.push(entry);
    const cutoff = entry.timestamp - RECENT_WINDOW_MS;
    let drop = this.recent.findIndex((e) => e.timestamp >= cutoff);
    if (drop < 0) drop = this.recent.length;
    drop = Math.max(drop, this.recent.length - RECENT_MAX_ENTRIES);
    if (drop > 0) this.recent.splice(0, drop);
  }

  /** The recording as CSV text — all of it, or just the last N rows. */
  toCSV(lastN?: number): string {
    return GPSDiagnosticLog.csv(
      lastN ? this.entries.slice(-lastN) : this.entries,
    );
  }

  /** The always-kept recent fixes as CSV text, or just the last N rows. */
  recentCSV(lastN?: number): string {
    return GPSDiagnosticLog.csv(
      lastN ? this.recent.slice(-lastN) : this.recent,
    );
  }

  private static csv(rows: GPSLogEntry[]): string {
    const headers = [
      "timestamp",
      "raw_lat",
      "raw_lon",
      "raw_sog",
      "raw_cog",
      "raw_accuracy",
      "filtered_lat",
      "filtered_lon",
      "filtered_sog",
      "filtered_cog",
      "smoothed_sog",
      "smoothed_cog",
      "adaptive_tier",
      "adaptive_interval_ms",
      "broadcast",
      "quality_q",
      "avg_sog",
      "avg_settling",
      "avg_provisional",
    ];
    const lines = [headers.join(",")];
    for (const e of rows) {
      lines.push(
        [
          e.timestamp,
          e.rawLat,
          e.rawLon,
          e.rawSog ?? "",
          e.rawCog ?? "",
          e.rawAccuracy ?? "",
          e.filteredLat,
          e.filteredLon,
          e.filteredSog ?? "",
          e.filteredCog ?? "",
          e.smoothedSog ?? "",
          e.smoothedCog ?? "",
          e.adaptiveTier,
          e.adaptiveIntervalMs,
          e.broadcast,
          e.qualityScore ?? "",
          e.avgSog ?? "",
          e.avgSettling ?? "",
          e.avgProvisional ?? "",
        ].join(","),
      );
    }
    return lines.join("\n");
  }

  /** Clear the recording; the recent fixes stay for bug reports. */
  clear(): void {
    this.entries = [];
    this.currentEntry = null;
  }
}

/** Singleton diagnostic logger. */
export const gpsDiagLog = new GPSDiagnosticLog();
