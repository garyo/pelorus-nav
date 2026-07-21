import { describe, expect, it } from "vitest";
import { recordScan, scanPerfEntries, scanPerfSummary } from "./scan-perf";

describe("scan-perf", () => {
  it("records entries with name, duration, and count", () => {
    const start = performance.now();
    recordScan("test-sweep", start, 42);
    const last = scanPerfEntries[scanPerfEntries.length - 1];
    expect(last.name).toBe("test-sweep");
    expect(last.count).toBe(42);
    expect(last.ms).toBeGreaterThanOrEqual(0);
  });

  it("aggregates per-name summaries", () => {
    recordScan("sweep-a", performance.now(), 10);
    recordScan("sweep-a", performance.now(), 20);
    const summary = scanPerfSummary().find((s) => s.name === "sweep-a");
    expect(summary).toBeDefined();
    expect(summary?.calls).toBeGreaterThanOrEqual(2);
    expect(summary?.lastCount).toBe(20);
    expect(summary?.maxMs).toBeGreaterThanOrEqual(summary?.meanMs ?? 0);
  });

  it("caps retained entries", () => {
    for (let i = 0; i < 2100; i++) {
      recordScan("cap-test", performance.now(), i);
    }
    expect(scanPerfEntries.length).toBeLessThanOrEqual(1000);
  });
});
