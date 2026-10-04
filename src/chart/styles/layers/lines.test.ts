import {
  expression,
  latest,
  type StylePropertySpecification,
} from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { wholeUnitContourDepth } from "./lines";

function contourDepth(unit: "feet" | "fathoms", valdco: number): number {
  const result = expression.createExpression(
    wholeUnitContourDepth(unit),
    latest.layout_symbol["text-size"] as StylePropertySpecification,
  );
  if (result.result === "error") {
    throw new Error(result.value.map((e) => e.message).join("; "));
  }
  return result.value.evaluate(
    { zoom: 14 },
    { type: "LineString", properties: { VALDCO: valdco } },
  ) as number;
}

describe("wholeUnitContourDepth", () => {
  it("labels NOAA's truncated foot contours with their whole foot", () => {
    // 6 ft → 1.8 m, 12 → 3.6, 20 → 6.0, 30 → 9.1, 60 → 18.2, 300 → 91.4
    const cases: [number, number][] = [
      [1.8, 6],
      [3.6, 12],
      [6.0, 20],
      [9.1, 30],
      [18.2, 60],
      [91.4, 300],
    ];
    for (const [metres, feet] of cases) {
      expect(contourDepth("feet", metres)).toBe(feet);
    }
  });

  it("floors metric-native contours (the shoaler reading)", () => {
    expect(contourDepth("feet", 2)).toBe(6); // 6.56 ft
    expect(contourDepth("feet", 5)).toBe(16); // 16.40 ft
    expect(contourDepth("feet", 6.3)).toBe(20); // 20.67 ft
  });

  it("labels NOAA's truncated fathom contours with their whole fathom", () => {
    expect(contourDepth("fathoms", 1.8)).toBe(1); // 1 fm → 1.8288 m
    expect(contourDepth("fathoms", 5.4)).toBe(3); // 3 fm → 5.4864 m
    expect(contourDepth("fathoms", 18.2)).toBe(10);
  });

  it("keeps zero at zero", () => {
    expect(contourDepth("feet", 0)).toBe(0);
  });
});
