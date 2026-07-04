import { describe, expect, it } from "vitest";
import { type CourseSnapshot, courseChanged } from "./course-gate";

const base: CourseSnapshot = { lat: 42.34, lon: -71.03, cog: 90, sog: 6 };

describe("courseChanged", () => {
  it("returns true for a null last-applied snapshot", () => {
    expect(courseChanged(null, base)).toBe(true);
  });

  it("returns false when all fields are identical", () => {
    expect(courseChanged(base, { ...base })).toBe(false);
  });

  it("position: sum-of-abs delta at 2e-7 passes, at 4e-8 is skipped", () => {
    expect(
      courseChanged(base, {
        ...base,
        lat: base.lat + 1e-7,
        lon: base.lon + 1e-7,
      }),
    ).toBe(true);
    expect(
      courseChanged(base, {
        ...base,
        lat: base.lat + 2e-8,
        lon: base.lon + 2e-8,
      }),
    ).toBe(false);
  });

  it("cog comparison is circular across the 0/360 wrap", () => {
    const at359 = { ...base, cog: 359.999 };
    expect(courseChanged(at359, { ...at359, cog: 0.001 })).toBe(false); // 0.002°
    const at35999 = { ...base, cog: 359.99 };
    expect(courseChanged(at35999, { ...at35999, cog: 0.01 })).toBe(true); // 0.02°
  });

  it("sog-only change of 0.02 kt passes; 0.005 kt is skipped", () => {
    expect(courseChanged(base, { ...base, sog: base.sog + 0.02 })).toBe(true);
    expect(courseChanged(base, { ...base, sog: base.sog + 0.005 })).toBe(false);
  });

  it("slow creep vs last-applied eventually passes once cumulative delta reaches epsilon", () => {
    // Repeated sub-epsilon steps against a FIXED last-applied snapshot: the
    // gate must open once accumulated drift crosses the threshold.
    const step = 3e-8;
    let lat = base.lat;
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      lat += step;
      results.push(courseChanged(base, { ...base, lat }));
    }
    expect(results).toEqual([false, false, false, true]);
  });
});
