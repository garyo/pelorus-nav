import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NavigationData } from "./NavigationData";
import { NMEAStream } from "./nmea-stream";

/** Compute the NMEA checksum and return the full `$...*HH` sentence. */
function withChecksum(body: string): string {
  let cs = 0;
  for (let i = 0; i < body.length; i++) cs ^= body.charCodeAt(i);
  return `$${body}*${cs.toString(16).toUpperCase().padStart(2, "0")}`;
}

/** RMC at a given time-of-fix (carries SOG/COG, no accuracy). */
function rmc(time: string, sog = "022.4", cog = "084.4"): string {
  return withChecksum(
    `GPRMC,${time},A,4807.038,N,01131.000,E,${sog},${cog},230394,,`,
  );
}

/** GGA at a given time-of-fix (carries accuracy via HDOP, no SOG/COG). */
function gga(time: string): string {
  return withChecksum(
    `GPGGA,${time},4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,`,
  );
}

function collect(): { stream: NMEAStream; fixes: NavigationData[] } {
  const fixes: NavigationData[] = [];
  const stream = new NMEAStream("test", (d) => fixes.push(d));
  return { stream, fixes };
}

describe("NMEAStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Same day as the canned sentences' RMC date field (230394): the GGA
    // nearest-day heuristic then agrees with the RMC date resolution, as in
    // production where the receiver clock tracks wall clock.
    vi.setSystemTime(new Date("1994-03-23T12:40:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces the RMC+GGA of one epoch into a single fix", () => {
    const { stream, fixes } = collect();
    stream.push(`${rmc("123519")}\r\n${gga("123519")}\r\n`);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].latitude).toBeCloseTo(48.1173, 3);
    expect(fixes[0].longitude).toBeCloseTo(11.5167, 3);
    expect(fixes[0].cog).toBeCloseTo(84.4, 1); // from RMC
    expect(fixes[0].sog).toBeCloseTo(22.4, 1); // from RMC
    expect(fixes[0].accuracy).not.toBeNull(); // from GGA's HDOP
    expect(fixes[0].source).toBe("test");
  });

  it("merges regardless of arrival order (GGA before RMC)", () => {
    const { stream, fixes } = collect();
    stream.push(`${gga("123519")}\r\n${rmc("123519")}\r\n`);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].sog).toBeCloseTo(22.4, 1);
    expect(fixes[0].accuracy).not.toBeNull();
  });

  it("coalesces sentences that arrive in separate chunks", () => {
    const { stream, fixes } = collect();
    stream.push(`${rmc("123519")}\r\n`);
    expect(fixes).toHaveLength(0); // epoch not complete yet
    stream.push(`${gga("123519")}\r\n`);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].sog).toBeCloseTo(22.4, 1);
    expect(fixes[0].accuracy).not.toBeNull();
  });

  it("emits one fix per epoch", () => {
    const { stream, fixes } = collect();
    stream.push(
      `${rmc("123519")}\r\n${gga("123519")}\r\n` +
        `${rmc("123520")}\r\n${gga("123520")}\r\n`,
    );
    expect(fixes).toHaveLength(2);
  });

  it("reassembles a sentence split across chunks", () => {
    const { stream, fixes } = collect();
    const whole = `${rmc("123519")}\r\n`;
    stream.push(whole.slice(0, 12));
    stream.push(whole.slice(12));
    stream.push(`${gga("123519")}\r\n`); // completes the epoch
    expect(fixes).toHaveLength(1);
    expect(fixes[0].latitude).toBeCloseTo(48.1173, 3);
  });

  it("flushes a still-incomplete epoch when the next epoch starts", () => {
    const { stream, fixes } = collect();
    stream.push(`${rmc("123519")}\r\n`);
    expect(fixes).toHaveLength(0); // waiting for this epoch's GGA
    stream.push(`${rmc("123520")}\r\n`); // new time-of-fix flushes 519
    expect(fixes).toHaveLength(1);
    expect(fixes[0].sog).toBeCloseTo(22.4, 1);
  });

  it("carries COG/SOG forward to a GGA-only epoch", () => {
    const { stream, fixes } = collect();
    stream.push(`${rmc("123519")}\r\n${gga("123519")}\r\n`); // fix 0
    stream.push(`${gga("123520")}\r\n`); // GGA-only epoch, buffered
    stream.push(`${rmc("123521")}\r\n`); // new epoch flushes 520
    expect(fixes).toHaveLength(2);
    expect(fixes[1].cog).toBeCloseTo(84.4, 1); // carried from epoch 519
    expect(fixes[1].sog).toBeCloseTo(22.4, 1);
    expect(fixes[1].accuracy).not.toBeNull(); // epoch 520's own GGA
  });

  it("ignores non-NMEA noise and bad checksums", () => {
    const { stream, fixes } = collect();
    stream.push("garbage line\r\n");
    stream.push(
      "$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,,*00\r\n",
    );
    expect(fixes).toHaveLength(0);
  });

  it("reset() drops the pending epoch and carried COG/SOG", () => {
    const { stream, fixes } = collect();
    stream.push(`${rmc("123519")}\r\n${gga("123519")}\r\n`); // fix 0
    stream.push(`${gga("123520")}`); // partial-buffered, not yet processed
    stream.reset();
    // Fresh GGA-only epoch with no prior RMC to borrow from.
    stream.push(`${gga("123520")}\r\n${rmc("123521")}\r\n`); // boundary flushes 520
    expect(fixes).toHaveLength(2);
    expect(fixes[1].cog).toBeNull();
    expect(fixes[1].sog).toBeNull();
  });

  it("routes $PPELD pod-status lines to onPodDiag, not the fix pipeline", () => {
    const { stream, fixes } = collect();
    const diags: string[] = [];
    stream.onPodDiag = (line) => diags.push(line);
    stream.push("$PPELD,120,1,34,5738,548,606,V*4A\r\n");
    stream.push(`${rmc("123519")}\r\n${gga("123519")}\r\n`);
    expect(diags).toEqual(["$PPELD,120,1,34,5738,548,606,V*4A"]);
    expect(fixes).toHaveLength(1); // the surrounding epoch still parses normally

    stream.onPodDiag = undefined;
    stream.push("$PPELD,121,1,35,5800,500,600,V*4B\r\n"); // no consumer — dropped
    expect(diags).toHaveLength(1);
  });
});
