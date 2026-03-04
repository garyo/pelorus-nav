import { describe, expect, it } from "vitest";
import {
  formatLatLon,
  haversineDistanceNM,
  toDegrees,
  toRadians,
} from "./coordinates";

describe("toRadians / toDegrees", () => {
  it("converts 180 degrees to PI radians", () => {
    expect(toRadians(180)).toBeCloseTo(Math.PI);
  });

  it("converts PI radians to 180 degrees", () => {
    expect(toDegrees(Math.PI)).toBeCloseTo(180);
  });

  it("round-trips correctly", () => {
    expect(toDegrees(toRadians(42.36))).toBeCloseTo(42.36);
  });
});

describe("haversineDistanceNM", () => {
  it("returns 0 for same point", () => {
    expect(haversineDistanceNM(42.36, -71.06, 42.36, -71.06)).toBe(0);
  });

  it("calculates Boston to Newport (~50 NM)", () => {
    // Boston Harbor to Newport RI is approximately 50 NM
    const dist = haversineDistanceNM(42.36, -71.06, 41.49, -71.31);
    expect(dist).toBeGreaterThan(45);
    expect(dist).toBeLessThan(55);
  });

  it("calculates one degree of latitude (~60 NM)", () => {
    const dist = haversineDistanceNM(0, 0, 1, 0);
    expect(dist).toBeCloseTo(60, 0);
  });
});

describe("formatLatLon", () => {
  it("formats positive latitude", () => {
    expect(formatLatLon(42.36, "lat")).toBe("42°21.60'N");
  });

  it("formats negative longitude", () => {
    expect(formatLatLon(-71.06, "lon")).toBe("071°03.60'W");
  });

  it("formats zero latitude as N", () => {
    expect(formatLatLon(0, "lat")).toBe("00°00.00'N");
  });
});
