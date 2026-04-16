/**
 * Diagnostic logger for the GPS filtering pipeline.
 * Records raw, Kalman-filtered, and smoothed data at each stage
 * for offline analysis. Data is stored in memory and can be
 * exported as CSV via the downloadFile utility.
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
}

const MAX_ENTRIES = 10_000; // ~5.5 hours at 2s intervals

class GPSDiagnosticLog {
  private entries: GPSLogEntry[] = [];
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

  /** Stage 1: Record raw GPS fix (before Kalman filter). */
  logRaw(
    timestamp: number,
    lat: number,
    lon: number,
    sog: number | null,
    cog: number | null,
    accuracy: number | null,
  ): void {
    if (!this._enabled) return;
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
    if (!this._enabled || !this.currentEntry) return;
    this.currentEntry.filteredLat = lat;
    this.currentEntry.filteredLon = lon;
    this.currentEntry.filteredSog = sog;
    this.currentEntry.filteredCog = cog;
  }

  /** Stage 3: Record adaptive rate state and broadcast decision. */
  logAdaptive(tier: string, intervalMs: number, broadcast: boolean): void {
    if (!this._enabled || !this.currentEntry) return;
    this.currentEntry.adaptiveTier = tier;
    this.currentEntry.adaptiveIntervalMs = intervalMs;
    this.currentEntry.broadcast = broadcast;
  }

  /** Stage 4: Record course-smoothed output (called on broadcast only). */
  logSmoothed(sog: number | null, cog: number | null): void {
    if (!this._enabled || !this.currentEntry) return;
    this.currentEntry.smoothedSog = sog;
    this.currentEntry.smoothedCog = cog;
  }

  /** Finalize the current entry and add it to the log. */
  commit(): void {
    if (!this._enabled || !this.currentEntry) return;
    this.entries.push(this.currentEntry as GPSLogEntry);
    this.currentEntry = null;
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }
  }

  /** Export all entries as CSV text. */
  toCSV(): string {
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
    ];
    const lines = [headers.join(",")];
    for (const e of this.entries) {
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
        ].join(","),
      );
    }
    return lines.join("\n");
  }

  clear(): void {
    this.entries = [];
    this.currentEntry = null;
  }
}

/** Singleton diagnostic logger. */
export const gpsDiagLog = new GPSDiagnosticLog();
