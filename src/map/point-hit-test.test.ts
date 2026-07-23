import { describe, expect, it } from "vitest";
import { nearestPointIndex } from "./point-hit-test";

/** Toy projection: 1 degree = 1 pixel, y down. */
const project = ([lon, lat]: [number, number]) => ({ x: lon, y: -lat });

const pt = (lon: number, lat: number) => ({ lat, lon });

describe("nearestPointIndex", () => {
  it("returns null with no points", () => {
    expect(nearestPointIndex([], { x: 0, y: 0 }, project, 20)).toBeNull();
  });

  it("finds a point under the target", () => {
    const points = [pt(0, 0), pt(100, 0)];
    expect(nearestPointIndex(points, { x: 100, y: 0 }, project, 20)).toBe(1);
  });

  it("accepts a point just inside the radius", () => {
    const points = [pt(0, 0)];
    expect(nearestPointIndex(points, { x: 20, y: 0 }, project, 20)).toBe(0);
  });

  it("rejects a point just outside the radius", () => {
    const points = [pt(0, 0)];
    expect(nearestPointIndex(points, { x: 21, y: 0 }, project, 20)).toBeNull();
  });

  it("measures diagonally, not per-axis", () => {
    const points = [pt(0, 0)];
    // (15,15) is 21.2 px away — outside a 20 px radius, inside a 20 px box.
    expect(nearestPointIndex(points, { x: 15, y: 15 }, project, 20)).toBeNull();
  });

  it("picks the nearest of several candidates in range", () => {
    const points = [pt(0, 0), pt(10, 0), pt(25, 0)];
    expect(nearestPointIndex(points, { x: 12, y: 0 }, project, 20)).toBe(1);
  });

  it("breaks ties toward the later point (drawn on top)", () => {
    const points = [pt(0, 0), pt(0, 0)];
    expect(nearestPointIndex(points, { x: 5, y: 0 }, project, 20)).toBe(1);
  });

  it("is unaffected by how many points are out of range", () => {
    const points = [pt(500, 0), pt(600, 0), pt(3, 0), pt(900, 0)];
    expect(nearestPointIndex(points, { x: 0, y: 0 }, project, 20)).toBe(2);
  });
});
