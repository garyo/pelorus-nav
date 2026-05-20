import { describe, expect, it } from "vitest";
import {
  circularInterpolate,
  circularMeanDeg,
} from "../navigation/CourseSmoothing";
import { formatTickLabel, selectAutoBucket } from "./CourseLine";

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

describe("selectAutoBucket", () => {
  it("returns paired (duration, tick) so duration % tick === 0", () => {
    // Sweep across plausible target durations; every bucket must divide evenly.
    for (const target of [0.3, 0.8, 1.5, 4, 7, 12, 22, 40, 100]) {
      const b = selectAutoBucket(target);
      const remainder = b.duration % b.tick;
      // Allow for tiny float drift on fractional ticks (e.g. 0.25, 0.5).
      expect(Math.min(remainder, b.tick - remainder)).toBeLessThan(1e-9);
    }
  });

  it("picks the nearest predefined duration on log scale", () => {
    expect(selectAutoBucket(0.8).duration).toBe(1);
    expect(selectAutoBucket(4).duration).toBe(5);
    expect(selectAutoBucket(7).duration).toBe(5);
    expect(selectAutoBucket(20).duration).toBe(15); // log-nearest: 15, not 30
    expect(selectAutoBucket(40).duration).toBe(30);
    expect(selectAutoBucket(1000).duration).toBe(60);
  });
});

describe("formatTickLabel", () => {
  it("formats sub-minute durations as seconds", () => {
    expect(formatTickLabel(0.25)).toBe("15s");
    expect(formatTickLabel(0.5)).toBe("30s");
  });

  it("formats minute durations", () => {
    expect(formatTickLabel(1)).toBe("1m");
    expect(formatTickLabel(15)).toBe("15m");
    expect(formatTickLabel(45)).toBe("45m");
  });

  it("formats hour durations", () => {
    expect(formatTickLabel(60)).toBe("1h");
  });
});
