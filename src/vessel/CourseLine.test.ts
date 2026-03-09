import { describe, expect, it } from "vitest";
import {
  circularInterpolate,
  circularMeanDeg,
} from "../navigation/CourseSmoothing";

describe("circularMeanDeg", () => {
  it("returns the single angle for a single-element array", () => {
    expect(circularMeanDeg([45])).toBeCloseTo(45);
  });

  it("averages two equal angles", () => {
    expect(circularMeanDeg([90, 90])).toBeCloseTo(90);
  });

  it("averages 350 and 10 to 0 (north wraparound)", () => {
    const mean = circularMeanDeg([350, 10]);
    expect(mean).toBeCloseTo(0, 0);
  });

  it("averages 355, 5 to ~0", () => {
    const mean = circularMeanDeg([355, 5]);
    expect(mean).toBeCloseTo(0, 0);
  });

  it("averages 90 and 270 (opposite directions — result is ambiguous)", () => {
    // atan2(0, 0) returns 0 — acceptable for opposite angles
    const mean = circularMeanDeg([90, 270]);
    // The result is unstable but should be a number
    expect(typeof mean).toBe("number");
  });

  it("averages east-facing angles", () => {
    const mean = circularMeanDeg([80, 100]);
    expect(mean).toBeCloseTo(90, 0);
  });
});

describe("circularInterpolate", () => {
  it("returns 'from' when t=0", () => {
    expect(circularInterpolate(45, 90, 0)).toBeCloseTo(45);
  });

  it("returns 'to' when t=1", () => {
    expect(circularInterpolate(45, 90, 1)).toBeCloseTo(90);
  });

  it("returns midpoint at t=0.5", () => {
    expect(circularInterpolate(0, 90, 0.5)).toBeCloseTo(45);
  });

  it("wraps across 0/360 boundary (350 → 10, shorter arc)", () => {
    const result = circularInterpolate(350, 10, 0.5);
    expect(result).toBeCloseTo(0, 0);
  });

  it("wraps the other direction (10 → 350, shorter arc)", () => {
    const result = circularInterpolate(10, 350, 0.5);
    expect(result).toBeCloseTo(0, 0);
  });

  it("does not wrap the long way around", () => {
    // From 10 to 350: shorter arc goes through 0, not through 180
    const result = circularInterpolate(10, 350, 0.25);
    // Should be close to 5, not 95
    expect(result).toBeCloseTo(5, 0);
  });
});
