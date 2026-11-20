import { describe, expect, it } from "vitest";
import { INSTRUMENT_WINDOW_MS, InstrumentLog } from "./instrumentLog";

describe("InstrumentLog", () => {
  it("records a line only when the panel changes", () => {
    const log = new InstrumentLog();
    log.record("SOG 6.0 kn", 0);
    log.record("SOG 6.0 kn", 1000);
    log.record("SOG 6.1 kn", 2000);
    expect(log.toText()).toBe(
      "1970-01-01T00:00:00.000Z  SOG 6.0 kn\n1970-01-01T00:00:02.000Z  SOG 6.1 kn",
    );
  });

  it("keeps the last INSTRUMENT_WINDOW_MS", () => {
    const log = new InstrumentLog();
    for (let m = 0; m <= 20; m++) log.record(`SOG ${m} kn`, m * 60_000);
    expect(log.entryCount).toBe(INSTRUMENT_WINDOW_MS / 60_000 + 1);
    expect(log.toText(1)).toContain("SOG 20 kn");
  });
});
