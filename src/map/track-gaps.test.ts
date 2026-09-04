import { describe, expect, it } from "vitest";
import { splitAtGaps, TRACK_GAP_MS } from "./track-gaps";

const pt = (timestamp: number) => ({ timestamp });

describe("splitAtGaps", () => {
  it("keeps a continuous track as one segment with no bridges", () => {
    const points = [pt(0), pt(10_000), pt(20_000)];
    expect(splitAtGaps(points)).toEqual({
      segments: [points],
      bridges: [],
    });
  });

  it("splits at a gap longer than the threshold and bridges its endpoints", () => {
    const resume = 10_000 + TRACK_GAP_MS + 1;
    const points = [pt(0), pt(10_000), pt(resume), pt(resume + 10_000)];
    const { segments, bridges } = splitAtGaps(points);
    expect(segments).toEqual([
      [points[0], points[1]],
      [points[2], points[3]],
    ]);
    expect(bridges).toEqual([[points[1], points[2]]]);
  });

  it("treats a hole of exactly the threshold as continuous", () => {
    const points = [pt(0), pt(TRACK_GAP_MS)];
    expect(splitAtGaps(points).segments).toEqual([points]);
  });

  it("handles consecutive gaps, leaving single-point segments intact", () => {
    const points = [pt(0), pt(1e6), pt(2e6)];
    const { segments, bridges } = splitAtGaps(points, 1000);
    expect(segments).toEqual([[points[0]], [points[1]], [points[2]]]);
    expect(bridges).toEqual([
      [points[0], points[1]],
      [points[1], points[2]],
    ]);
  });

  it("returns nothing for an empty track", () => {
    expect(splitAtGaps([])).toEqual({ segments: [], bridges: [] });
  });
});
