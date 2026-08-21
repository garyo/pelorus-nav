import { describe, expect, it } from "vitest";
import {
  anchorLengthUnit,
  defaultRadiusM,
  formatLength,
  fromDisplayLength,
  GPS_MARGIN_MIN_M,
  gpsMarginM,
  horizontalReachM,
  M_TO_FT,
  radiusStepM,
  toDisplayLength,
} from "./anchor-setup";

describe("anchorLengthUnit", () => {
  it("uses meters only for the metric depth unit", () => {
    expect(anchorLengthUnit("meters")).toBe("m");
    expect(anchorLengthUnit("feet")).toBe("ft");
    expect(anchorLengthUnit("fathoms")).toBe("ft");
  });
});

describe("gpsMarginM", () => {
  it("floors at the minimum margin", () => {
    expect(gpsMarginM(3, 2)).toBe(GPS_MARGIN_MIN_M);
    expect(gpsMarginM(null, null)).toBe(GPS_MARGIN_MIN_M);
    expect(gpsMarginM(undefined, 0)).toBe(GPS_MARGIN_MIN_M);
  });

  it("uses the worst of accuracy and scatter", () => {
    expect(gpsMarginM(18, 12)).toBe(18);
    expect(gpsMarginM(12, 25)).toBe(25);
  });
});

describe("horizontalReachM", () => {
  it("returns the horizontal leg of the rode triangle", () => {
    // 100 rode over 26 vertical → sqrt(10000 − 676) ≈ 96.56
    expect(horizontalReachM(100, 20, 6)).toBeCloseTo(96.56, 2);
    // The error rode-as-reach would make grows sharply with depth.
    expect(horizontalReachM(100, 60, 6)).toBeCloseTo(75.13, 2);
  });

  it("falls back to the rode when there is no vertical distance", () => {
    expect(horizontalReachM(50, 0, 0)).toBe(50);
    expect(horizontalReachM(50, undefined, undefined)).toBe(50);
  });

  it("returns 0 when the rode cannot reach the bottom", () => {
    expect(horizontalReachM(20, 30, 2)).toBe(0);
    expect(horizontalReachM(0, 10, 2)).toBe(0);
    expect(horizontalReachM(undefined, 10, 2)).toBe(0);
  });
});

describe("defaultRadiusM", () => {
  it("uses the horizontal swing reach when a depth is known", () => {
    // reach 96.56 + boat 12 + margin 10 → 119 (ceil)
    expect(defaultRadiusM(100, 12, 10, 20, 6)).toBe(119);
    // Without depth the rode is used directly, as before.
    expect(defaultRadiusM(100, 12, 10)).toBe(122);
  });

  it("sums rode + boat length + margin, rounded up", () => {
    expect(defaultRadiusM(30, 10, 10)).toBe(50);
    expect(defaultRadiusM(30.2, 10.3, 10)).toBe(51);
  });

  it("treats missing rode/boat length as zero", () => {
    expect(defaultRadiusM(undefined, undefined, 10)).toBe(10);
    expect(defaultRadiusM(25, undefined, 12)).toBe(37);
  });
});

describe("length display conversions", () => {
  it("round-trips meters through feet within rounding", () => {
    expect(toDisplayLength(30, "m")).toBe(30);
    expect(toDisplayLength(30, "ft")).toBe(98);
    expect(fromDisplayLength(98, "ft")).toBeCloseTo(98 / M_TO_FT, 6);
    expect(fromDisplayLength(30, "m")).toBe(30);
  });

  it("formats with the unit label", () => {
    expect(formatLength(25, "m")).toBe("25 m");
    expect(formatLength(25, "ft")).toBe("82 ft");
  });
});

describe("radiusStepM", () => {
  it("is 5 m metric, 15 ft imperial", () => {
    expect(radiusStepM("m")).toBe(5);
    expect(radiusStepM("ft")).toBeCloseTo(15 / M_TO_FT, 6);
  });
});
