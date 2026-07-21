/**
 * Lightweight timing recorder for main-thread chart sweeps
 * (SafetyContour DEPCNT scan, light-overlay LIGHTS query, chart-in-use
 * readout). Always on: each record emits a performance.measure — so the
 * spans show up named in a DevTools performance profile — and appends to
 * a capped in-memory log exposed as `window.scanPerf` for console
 * inspection (`scanPerf.summary()`, `scanPerf.entries`).
 */

export interface ScanPerfEntry {
  name: string;
  /** Duration in ms (0.1 ms resolution). */
  ms: number;
  /** Item count processed (features returned, etc.). */
  count: number;
  /** Start time, ms since page load. */
  t: number;
}

export interface ScanPerfSummary {
  name: string;
  calls: number;
  meanMs: number;
  maxMs: number;
  lastMs: number;
  lastCount: number;
}

const MAX_ENTRIES = 1000;
const entries: ScanPerfEntry[] = [];

/** Record one sweep: pass performance.now() taken before the work. */
export function recordScan(name: string, startMs: number, count: number): void {
  const ms = performance.now() - startMs;
  performance.measure(`${name} [${count}]`, { start: startMs });
  entries.push({
    name,
    ms: Math.round(ms * 10) / 10,
    count,
    t: Math.round(startMs),
  });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length / 2);
}

/** Per-name aggregate over all retained entries. */
export function scanPerfSummary(): ScanPerfSummary[] {
  const byName = new Map<string, ScanPerfEntry[]>();
  for (const e of entries) {
    const list = byName.get(e.name);
    if (list) list.push(e);
    else byName.set(e.name, [e]);
  }
  return [...byName].map(([name, list]) => {
    const last = list[list.length - 1];
    return {
      name,
      calls: list.length,
      meanMs:
        Math.round((list.reduce((s, e) => s + e.ms, 0) / list.length) * 10) /
        10,
      maxMs: Math.max(...list.map((e) => e.ms)),
      lastMs: last.ms,
      lastCount: last.count,
    };
  });
}

export const scanPerfEntries: readonly ScanPerfEntry[] = entries;

// Console access (window is absent in unit tests).
if (typeof window !== "undefined") {
  (window as unknown as { scanPerf: unknown }).scanPerf = {
    entries,
    summary: scanPerfSummary,
    clear: () => entries.splice(0),
  };
}
