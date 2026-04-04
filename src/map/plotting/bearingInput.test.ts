import { describe, expect, it } from "vitest";
import { parseBearingInput, parseDistanceInput } from "./bearingInput";

// Mock declination: ~14.5°W (negative) for Boston area
// getDeclination returns east-positive, so Boston is about -14.5

describe("parseBearingInput", () => {
  // Using lat/lon near Boston for declination (~-14.5°)
  const lat = 42.36;
  const lon = -71.06;

  it("parses a plain number using default mode (magnetic)", () => {
    const result = parseBearingInput("121", "magnetic", lat, lon);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("121°M");
    // True = magnetic + declination. Declination is ~-14.5, so true = 121 + (-14.5) ≈ 106.5
    // True = magnetic + declination (east-positive). WMM value varies by year.
    expect(result!.trueBearing).toBeGreaterThan(105);
    expect(result!.trueBearing).toBeLessThan(110);
  });

  it("parses a plain number using default mode (true)", () => {
    const result = parseBearingInput("121", "true", lat, lon);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("121°T");
    expect(result!.trueBearing).toBe(121);
  });

  it('parses "121M" as magnetic', () => {
    const result = parseBearingInput("121M", "true", lat, lon);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("121°M");
    // M suffix overrides the default "true" mode
    // True = magnetic + declination (east-positive). WMM value varies by year.
    expect(result!.trueBearing).toBeGreaterThan(105);
    expect(result!.trueBearing).toBeLessThan(110);
  });

  it('parses "106T" as true', () => {
    const result = parseBearingInput("106T", "magnetic", lat, lon);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("106°T");
    expect(result!.trueBearing).toBe(106);
  });

  it('parses "121°M" with degree symbol', () => {
    const result = parseBearingInput("121°M", "true", lat, lon);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("121°M");
  });

  it("returns null for invalid input", () => {
    expect(parseBearingInput("", "true", lat, lon)).toBeNull();
    expect(parseBearingInput("abc", "true", lat, lon)).toBeNull();
    expect(parseBearingInput("400", "true", lat, lon)).toBeNull();
    expect(parseBearingInput("-10", "true", lat, lon)).toBeNull();
  });

  it("handles 0 degrees", () => {
    const result = parseBearingInput("0T", "true", lat, lon);
    expect(result).not.toBeNull();
    expect(result!.trueBearing).toBe(0);
    expect(result!.label).toBe("000°T");
  });

  it("handles decimal bearings", () => {
    const result = parseBearingInput("121.5T", "true", lat, lon);
    expect(result).not.toBeNull();
    expect(result!.trueBearing).toBe(121.5);
    expect(result!.label).toBe("122°T"); // rounded in label
  });

  it("handles lowercase suffix", () => {
    const result = parseBearingInput("121m", "true", lat, lon);
    expect(result).not.toBeNull();
    expect(result!.label).toBe("121°M");
  });
});

describe("parseDistanceInput", () => {
  it("parses plain number as NM", () => {
    expect(parseDistanceInput("1.5")).toBe(1.5);
  });

  it("parses nm suffix", () => {
    expect(parseDistanceInput("2.0nm")).toBe(2.0);
    expect(parseDistanceInput("2.0NM")).toBe(2.0);
  });

  it("parses feet", () => {
    expect(parseDistanceInput("6076ft")).toBeCloseTo(1.0, 1); // ~1 NM
  });

  it("parses feet with apostrophe", () => {
    expect(parseDistanceInput("6076'")).toBeCloseTo(1.0, 1);
  });

  it("parses metres", () => {
    expect(parseDistanceInput("1852m")).toBeCloseTo(1.0, 2); // 1 NM
  });

  it("returns null for invalid input", () => {
    expect(parseDistanceInput("")).toBeNull();
    expect(parseDistanceInput("abc")).toBeNull();
    expect(parseDistanceInput("0")).toBeNull();
    expect(parseDistanceInput("-5")).toBeNull();
  });
});
