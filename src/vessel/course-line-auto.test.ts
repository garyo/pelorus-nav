import { describe, expect, it } from "vitest";
import {
  autoAheadPx,
  EDGE_FRACTION,
  MIN_FRACTION,
  OFFSCREEN_FRACTION,
  rayToEdgePx,
} from "./course-line-auto";

const phone = { width: 360, height: 780 };

describe("rayToEdgePx", () => {
  it("measures straight up, down, left and right from the centre", () => {
    const c = { x: 180, y: 390 };
    expect(rayToEdgePx(c, 0, phone)).toBeCloseTo(390);
    expect(rayToEdgePx(c, 180, phone)).toBeCloseTo(390);
    expect(rayToEdgePx(c, 90, phone)).toBeCloseTo(180);
    expect(rayToEdgePx(c, 270, phone)).toBeCloseTo(180);
  });

  it("hits the nearer edge on a diagonal", () => {
    // North-east from the centre of a portrait screen: the right edge is
    // 180 px away, reached after 180/sin(45°) ≈ 255 px.
    expect(rayToEdgePx({ x: 180, y: 390 }, 45, phone)).toBeCloseTo(254.56, 1);
  });

  it("is infinite for an off-screen origin heading away", () => {
    expect(rayToEdgePx({ x: -50, y: 100 }, 270, phone)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("autoAheadPx", () => {
  it("reaches most of the way to the edge ahead", () => {
    expect(autoAheadPx({ x: 180, y: 390 }, 0, phone)).toBeCloseTo(
      EDGE_FRACTION * 390,
    );
  });

  it("shortens for a course toward a near side edge (the reported case)", () => {
    // Vessel left of centre heading east-north-east on a phone in north-up:
    // the right edge is ~330 px away along the course, so the line must be
    // shorter than that, and never shorter than the floor.
    const px = autoAheadPx({ x: 148, y: 437 }, 60, phone);
    expect(px).toBeLessThan(330);
    expect(px).toBeGreaterThanOrEqual(MIN_FRACTION * 360);
  });

  it("never drops below the minimum fraction of the short side", () => {
    // Almost on the right edge, heading right.
    expect(autoAheadPx({ x: 355, y: 400 }, 90, phone)).toBeCloseTo(
      MIN_FRACTION * 360,
    );
  });

  it("caps at one long side even from the far corner", () => {
    const wide = { width: 2000, height: 400 };
    expect(autoAheadPx({ x: 0, y: 200 }, 90, wide)).toBeLessThanOrEqual(2000);
  });

  it("uses a bit less than one screen when the vessel is off screen", () => {
    expect(autoAheadPx({ x: -100, y: 200 }, 90, phone)).toBeCloseTo(
      OFFSCREEN_FRACTION * 360,
    );
    expect(autoAheadPx({ x: 100, y: 900 }, 0, phone)).toBeCloseTo(
      OFFSCREEN_FRACTION * 360,
    );
  });
});
