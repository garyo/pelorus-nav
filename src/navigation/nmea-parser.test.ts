import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseGGA, parseNMEA, parseRMC } from "./nmea-parser";

describe("NMEA parser", () => {
  describe("parseRMC", () => {
    it("parses valid $GPRMC sentence", () => {
      const sentence =
        "$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A";
      const result = parseRMC(sentence);
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.latitude).toBeCloseTo(48.1173, 3);
      expect(result.longitude).toBeCloseTo(11.5167, 3);
      expect(result.sog).toBeCloseTo(22.4, 1);
      expect(result.cog).toBeCloseTo(84.4, 1);
    });

    it("parses $GNRMC variant", () => {
      const sentence =
        "$GNRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*74";
      const result = parseRMC(sentence);
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.latitude).toBeCloseTo(48.1173, 3);
    });

    it("rejects void status", () => {
      const sentence =
        "$GPRMC,123519,V,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*7D";
      expect(parseRMC(sentence)).toBeNull();
    });

    it("rejects bad checksum", () => {
      const sentence =
        "$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*FF";
      expect(parseRMC(sentence)).toBeNull();
    });

    it("parses south/west coordinates", () => {
      const sentence =
        "$GPRMC,120000,A,4221.060,S,07056.460,W,006.0,247.0,070326,,*13";
      const result = parseRMC(sentence);
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.latitude).toBeLessThan(0);
      expect(result.longitude).toBeLessThan(0);
    });
  });

  describe("parseGGA", () => {
    it("parses valid $GPGGA sentence", () => {
      const sentence =
        "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,47.0,M,,*4F";
      const result = parseGGA(sentence);
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.latitude).toBeCloseTo(48.1173, 3);
      expect(result.longitude).toBeCloseTo(11.5167, 3);
      expect(result.altitude).toBeCloseTo(545.4, 1);
      expect(result.accuracy).toBeCloseTo(4.5, 1); // HDOP 0.9 * 5
    });

    it("rejects no-fix sentence", () => {
      const sentence = "$GPGGA,123519,4807.038,N,01131.000,E,0,00,,,,,,,*52";
      expect(parseGGA(sentence)).toBeNull();
    });

    it("parses $GNGGA variant", () => {
      const sentence =
        "$GNGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,47.0,M,,*51";
      const result = parseGGA(sentence);
      expect(result).not.toBeNull();
    });
  });

  describe("parseNMEA", () => {
    it("routes RMC sentences", () => {
      const sentence =
        "$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A";
      expect(parseNMEA(sentence)).not.toBeNull();
    });

    it("routes GGA sentences", () => {
      const sentence =
        "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,47.0,M,,*4F";
      expect(parseNMEA(sentence)).not.toBeNull();
    });

    it("returns null for unsupported sentences", () => {
      expect(parseNMEA("$GPVTG,054.7,T,034.4,M,005.5,N,010.2,K*48")).toBeNull();
    });
  });
});

// Build a valid sentence from a body (computes the checksum).
function nmea(body: string): string {
  let cs = 0;
  for (const ch of body) cs ^= ch.charCodeAt(0);
  return `$${body}*${cs.toString(16).toUpperCase().padStart(2, "0")}`;
}

describe("timestamp resolution around UTC midnight", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("RMC date field is authoritative (no +24h jump after midnight)", () => {
    vi.setSystemTime(new Date("2026-07-04T00:00:05Z"));
    const r = parseRMC(
      nmea("GPRMC,235959.00,A,4226.135,N,07110.042,W,5.0,90.0,030726,,"),
    );
    expect(r?.timestamp).toBe(Date.UTC(2026, 6, 3, 23, 59, 59));
  });

  it("GGA just after UTC midnight resolves to yesterday", () => {
    vi.setSystemTime(new Date("2026-07-04T00:00:30Z"));
    const g = parseGGA(
      nmea("GPGGA,235959.00,4226.135,N,07110.042,W,1,08,1.2,10.0,M,,M,,"),
    );
    expect(g?.timestamp).toBe(Date.UTC(2026, 6, 3, 23, 59, 59));
  });

  it("GGA just before midnight with an early next-day fix resolves to tomorrow", () => {
    vi.setSystemTime(new Date("2026-07-03T23:59:40Z"));
    const g = parseGGA(
      nmea("GPGGA,000001.00,4226.135,N,07110.042,W,1,08,1.2,10.0,M,,M,,"),
    );
    expect(g?.timestamp).toBe(Date.UTC(2026, 6, 4, 0, 0, 1));
  });

  it("GGA same-day time passes through unchanged", () => {
    vi.setSystemTime(new Date("2026-07-04T12:00:01Z"));
    const g = parseGGA(
      nmea("GPGGA,120000.50,4226.135,N,07110.042,W,1,08,1.2,10.0,M,,M,,"),
    );
    expect(g?.timestamp).toBe(Date.UTC(2026, 6, 4, 12, 0, 0, 500));
  });

  it("RMC (dated) and GGA (heuristic) agree across the midnight straddle", () => {
    // Same HHMMSS emitted by the receiver in one epoch, parsed after
    // midnight: both must resolve to the identical timestamp so
    // NMEAStream's exact-equality epoch merge still coalesces them.
    vi.setSystemTime(new Date("2026-07-04T00:00:10Z"));
    const r = parseRMC(
      nmea("GPRMC,235958.00,A,4226.135,N,07110.042,W,5.0,90.0,030726,,"),
    );
    const g = parseGGA(
      nmea("GPGGA,235958.00,4226.135,N,07110.042,W,1,08,1.2,10.0,M,,M,,"),
    );
    expect(r?.timestamp).toBe(g?.timestamp);
  });
});
