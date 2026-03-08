import { describe, expect, it } from "vitest";
import { parseGGA, parseNMEA, parseRMC } from "./nmea-parser";

describe("NMEA parser", () => {
  describe("parseRMC", () => {
    it("parses valid $GPRMC sentence", () => {
      const sentence =
        "$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A";
      const result = parseRMC(sentence);
      expect(result).not.toBeNull();
      expect(result!.latitude).toBeCloseTo(48.1173, 3);
      expect(result!.longitude).toBeCloseTo(11.5167, 3);
      expect(result!.sog).toBeCloseTo(22.4, 1);
      expect(result!.cog).toBeCloseTo(84.4, 1);
    });

    it("parses $GNRMC variant", () => {
      const sentence =
        "$GNRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*74";
      const result = parseRMC(sentence);
      expect(result).not.toBeNull();
      expect(result!.latitude).toBeCloseTo(48.1173, 3);
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
      expect(result!.latitude).toBeLessThan(0);
      expect(result!.longitude).toBeLessThan(0);
    });
  });

  describe("parseGGA", () => {
    it("parses valid $GPGGA sentence", () => {
      const sentence =
        "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,47.0,M,,*4F";
      const result = parseGGA(sentence);
      expect(result).not.toBeNull();
      expect(result!.latitude).toBeCloseTo(48.1173, 3);
      expect(result!.longitude).toBeCloseTo(11.5167, 3);
      expect(result!.altitude).toBeCloseTo(545.4, 1);
      expect(result!.accuracy).toBeCloseTo(4.5, 1); // HDOP 0.9 * 5
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
