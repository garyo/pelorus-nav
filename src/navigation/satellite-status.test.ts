import { describe, expect, it } from "vitest";
import { parseGSA, parseGSV, SatelliteTracker } from "./satellite-status";

/** Append the NMEA XOR checksum, returning the full `$...*HH` sentence. */
function withChecksum(body: string): string {
  let cs = 0;
  for (let i = 0; i < body.length; i++) cs ^= body.charCodeAt(i);
  return `$${body}*${cs.toString(16).toUpperCase().padStart(2, "0")}`;
}

describe("parseGSV", () => {
  it("parses satellites in view with SNR", () => {
    const msg = parseGSV(
      withChecksum(
        "GPGSV,2,1,07,01,40,083,46,02,17,308,43,03,07,344,39,04,80,123,50",
      ),
    );
    expect(msg).not.toBeNull();
    expect(msg?.talker).toBe("GP");
    expect(msg?.totalMessages).toBe(2);
    expect(msg?.messageNumber).toBe(1);
    expect(msg?.satellites).toHaveLength(4);
    expect(msg?.satellites[0]).toMatchObject({
      prn: 1,
      elevation: 40,
      azimuth: 83,
      snr: 46,
      constellation: "GPS",
    });
  });

  it("handles a blank SNR (in view, not tracked) as null", () => {
    const msg = parseGSV(withChecksum("GPGSV,1,1,01,12,22,180,"));
    expect(msg?.satellites[0]).toMatchObject({ prn: 12, snr: null });
  });

  it("ignores a trailing signalId field (NMEA 4.10)", () => {
    const msg = parseGSV(withChecksum("GAGSV,1,1,01,11,50,200,44,7"));
    expect(msg?.satellites).toHaveLength(1);
    expect(msg?.satellites[0]).toMatchObject({
      prn: 11,
      constellation: "Galileo",
    });
  });

  it("rejects a bad checksum", () => {
    expect(parseGSV("$GPGSV,1,1,01,12,22,180,33*00")).toBeNull();
  });
});

describe("parseGSA", () => {
  it("parses fix type, used PRNs, and DOP", () => {
    const msg = parseGSA(
      withChecksum("GPGSA,A,3,01,02,03,04,,,,,,,,,2.5,1.3,2.1"),
    );
    expect(msg).toMatchObject({
      fixType: 3,
      usedPrns: [1, 2, 3, 4],
      pdop: 2.5,
      hdop: 1.3,
      vdop: 2.1,
    });
  });

  it("handles a trailing systemId field (NMEA 4.10)", () => {
    const msg = parseGSA(
      withChecksum("GNGSA,A,3,01,02,,,,,,,,,,,2.0,1.0,1.7,1"),
    );
    expect(msg).toMatchObject({ fixType: 3, hdop: 1.0, vdop: 1.7 });
  });
});

describe("SatelliteTracker", () => {
  it("assembles a multi-message GSV burst into one epoch snapshot", () => {
    const t = new SatelliteTracker();
    t.ingest(
      withChecksum(
        "GPGSV,2,1,05,01,40,083,46,02,17,308,43,03,07,344,39,04,80,123,50",
      ),
    );
    t.ingest(withChecksum("GPGSV,2,2,05,05,30,200,41"));
    const status = t.commitEpoch();
    expect(status?.inView).toBe(5);
    expect(status?.satellites).toHaveLength(5);
  });

  it("returns null when nothing was ingested since the last commit", () => {
    const t = new SatelliteTracker();
    t.ingest(withChecksum("GPGSV,1,1,01,01,40,083,46"));
    expect(t.commitEpoch()).not.toBeNull();
    expect(t.commitEpoch()).toBeNull(); // quiet gap — don't blank the display
  });

  it("marks used satellites and reports fix quality from GSA", () => {
    const t = new SatelliteTracker();
    t.ingest(
      withChecksum("GPGSV,1,1,03,01,40,083,46,02,17,308,43,03,07,344,39"),
    );
    t.ingest(withChecksum("GPGSA,A,3,01,02,,,,,,,,,,,2.0,1.0,1.5"));
    const status = t.commitEpoch();
    expect(status?.fixType).toBe(3);
    expect(status?.used).toBe(2);
    expect(status?.hdop).toBe(1.0);
    const used = status?.satellites.filter((s) => s.used).map((s) => s.prn);
    expect(used).toEqual([1, 2]);
  });

  it("unions satellites across constellations within an epoch", () => {
    const t = new SatelliteTracker();
    t.ingest(withChecksum("GPGSV,1,1,02,01,40,083,46,02,17,308,43"));
    t.ingest(withChecksum("GLGSV,1,1,01,65,22,120,38"));
    const status = t.commitEpoch();
    expect(status?.inView).toBe(3);
    expect(status?.satellites.map((s) => s.constellation)).toContain("GLONASS");
  });

  it("merges the same satellite across signals, keeping the stronger C/N0", () => {
    const t = new SatelliteTracker();
    t.ingest(withChecksum("GPGSV,1,1,01,09,55,010,48,1")); // L1
    t.ingest(withChecksum("GPGSV,1,1,01,09,55,010,32,6")); // L5, weaker
    const status = t.commitEpoch();
    expect(status?.inView).toBe(1);
    expect(status?.satellites[0]).toMatchObject({ prn: 9, snr: 48 });
  });

  it("starts a fresh count each epoch (no accumulation across bursts)", () => {
    const t = new SatelliteTracker();
    t.ingest(withChecksum("GPGSV,1,1,02,01,40,083,46,02,17,308,43"));
    t.commitEpoch();
    t.ingest(withChecksum("GPGSV,1,1,01,09,55,010,48"));
    const status = t.commitEpoch();
    expect(status?.inView).toBe(1);
    expect(status?.satellites[0].prn).toBe(9);
  });
});
