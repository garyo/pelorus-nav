import { describe, expect, it } from "vitest";
import type { NavigationData } from "./NavigationData";
import { NMEAStream } from "./nmea-stream";

/** Compute the NMEA checksum and return the full `$...*HH` sentence. */
function withChecksum(body: string): string {
  let cs = 0;
  for (let i = 0; i < body.length; i++) cs ^= body.charCodeAt(i);
  return `$${body}*${cs.toString(16).toUpperCase().padStart(2, "0")}`;
}

const RMC = withChecksum(
  "GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,,",
);
const GGA = withChecksum(
  "GPGGA,123520,4807.500,N,01131.200,E,1,08,0.9,545.4,M,46.9,M,,",
);

function collect(): { stream: NMEAStream; fixes: NavigationData[] } {
  const fixes: NavigationData[] = [];
  const stream = new NMEAStream("test", (d) => fixes.push(d));
  return { stream, fixes };
}

describe("NMEAStream", () => {
  it("parses a complete RMC line into a fix", () => {
    const { stream, fixes } = collect();
    stream.push(`${RMC}\r\n`);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].latitude).toBeCloseTo(48.1173, 3);
    expect(fixes[0].longitude).toBeCloseTo(11.5167, 3);
    expect(fixes[0].cog).toBeCloseTo(84.4, 1);
    expect(fixes[0].sog).toBeCloseTo(22.4, 1);
    expect(fixes[0].source).toBe("test");
  });

  it("reassembles a sentence split across chunks", () => {
    const { stream, fixes } = collect();
    const whole = `${RMC}\r\n`;
    stream.push(whole.slice(0, 12));
    stream.push(whole.slice(12, 30));
    expect(fixes).toHaveLength(0); // nothing emitted until the newline arrives
    stream.push(whole.slice(30));
    expect(fixes).toHaveLength(1);
    expect(fixes[0].latitude).toBeCloseTo(48.1173, 3);
  });

  it("handles multiple sentences in one chunk", () => {
    const { stream, fixes } = collect();
    stream.push(`${RMC}\r\n${RMC}\r\n`);
    expect(fixes).toHaveLength(2);
  });

  it("carries COG/SOG forward to a GGA that lacks them", () => {
    const { stream, fixes } = collect();
    stream.push(`${RMC}\r\n${GGA}\r\n`);
    expect(fixes).toHaveLength(2);
    // GGA has no COG/SOG, so the RMC values carry forward.
    expect(fixes[1].cog).toBeCloseTo(84.4, 1);
    expect(fixes[1].sog).toBeCloseTo(22.4, 1);
    // GGA supplies accuracy (from HDOP); RMC does not.
    expect(fixes[1].accuracy).not.toBeNull();
  });

  it("ignores non-NMEA noise and bad checksums", () => {
    const { stream, fixes } = collect();
    stream.push("garbage line\r\n");
    stream.push(
      "$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,,*00\r\n",
    );
    expect(fixes).toHaveLength(0);
  });

  it("reset() drops the buffered partial line and carried COG/SOG", () => {
    const { stream, fixes } = collect();
    stream.push(`${RMC}\r\n${"$GPGGA,123520,4807.500"}`); // partial GGA buffered
    stream.reset();
    stream.push(`${GGA}\r\n`); // fresh GGA, no prior RMC to borrow from
    expect(fixes).toHaveLength(2);
    expect(fixes[1].cog).toBeNull();
    expect(fixes[1].sog).toBeNull();
  });
});
