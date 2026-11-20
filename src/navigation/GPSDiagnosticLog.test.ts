import { describe, expect, it } from "vitest";
import {
  GPSDiagnosticLog,
  gpsDiagLog,
  RECENT_WINDOW_MS,
} from "./GPSDiagnosticLog";

function logFix(log: GPSDiagnosticLog, i: number, t = 1000 + i): void {
  log.logRaw(t, 42 + i * 0.001, -71, 5, 90, 10);
  log.logFiltered(42 + i * 0.001, -71, 5, 90);
  log.logAdaptive("fast", 2000, true);
  log.commit();
}

describe("GPSDiagnosticLog.toCSV", () => {
  it("toCSV(lastN) returns header plus only the last N rows", () => {
    gpsDiagLog.start();
    for (let i = 0; i < 5; i++) logFix(gpsDiagLog, i);
    const lines = gpsDiagLog.toCSV(2).split("\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[1].startsWith("1003,")).toBe(true);
    expect(lines[2].startsWith("1004,")).toBe(true);
    gpsDiagLog.stop();
    gpsDiagLog.clear();
  });

  it("toCSV() without lastN returns all rows", () => {
    gpsDiagLog.start();
    for (let i = 0; i < 3; i++) logFix(gpsDiagLog, i);
    expect(gpsDiagLog.toCSV().split("\n")).toHaveLength(4);
    gpsDiagLog.stop();
    gpsDiagLog.clear();
  });
});

describe("GPSDiagnosticLog recent fixes", () => {
  it("keeps the last RECENT_WINDOW_MS of fixes without a recording", () => {
    const log = new GPSDiagnosticLog();
    for (let i = 0; i <= 20; i++) logFix(log, i, i * 60_000); // 20 minutes
    expect(log.entryCount).toBe(0);
    const rows = log.recentCSV().split("\n").slice(1);
    expect(rows).toHaveLength(RECENT_WINDOW_MS / 60_000 + 1);
    expect(rows[0].startsWith(`${5 * 60_000},`)).toBe(true);
  });

  it("keeps them when a recording is cleared", () => {
    const log = new GPSDiagnosticLog();
    log.start();
    for (let i = 0; i < 3; i++) logFix(log, i);
    log.stop();
    log.clear();
    expect(log.entryCount).toBe(0);
    expect(log.recentCount).toBe(3);
  });

  it("logs whether the average speed was provisional", () => {
    const log = new GPSDiagnosticLog();
    log.logRaw(0, 42, -71, 5, 90, 10);
    log.logAverage(5, false, true);
    log.commit();
    const [header, row] = log.recentCSV().split("\n");
    expect(header.endsWith("avg_settling,avg_provisional")).toBe(true);
    expect(row.endsWith("false,true")).toBe(true);
  });
});
