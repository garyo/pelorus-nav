import { describe, expect, it } from "vitest";
import { gpsDiagLog } from "./GPSDiagnosticLog";

function logFix(log: typeof gpsDiagLog, i: number): void {
  log.logRaw(1000 + i, 42 + i * 0.001, -71, 5, 90, 10);
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
