import { describe, expect, it } from "vitest";
import { cellsToRings, footprintFromCells } from "./chart-footprint";

/** Corner count excluding the closing point. */
function cornerCount(ring: [number, number][]): number {
  return ring.length - 1;
}

function ringsFor(cells: string[]): [number, number][][] {
  return cellsToRings(new Set(cells), 4);
}

describe("cellsToRings", () => {
  it("traces a single cell as one closed 4-corner ring", () => {
    const rings = ringsFor(["3,5"]);
    expect(rings).toHaveLength(1);
    expect(cornerCount(rings[0])).toBe(4);
    // Closed
    expect(rings[0][0]).toEqual(rings[0][rings[0].length - 1]);
    // Corner sanity: at z4, tile x=3 west edge is 3/16*360-180 = -112.5
    expect(rings[0].some(([lon]) => lon === -112.5)).toBe(true);
    expect(rings[0].some(([lon]) => lon === -90)).toBe(true); // x=4 edge
  });

  it("merges a 2x1 block into one rectangle (collinear points dropped)", () => {
    const rings = ringsFor(["3,5", "4,5"]);
    expect(rings).toHaveLength(1);
    expect(cornerCount(rings[0])).toBe(4);
  });

  it("traces an L-shape as one 6-corner ring", () => {
    const rings = ringsFor(["3,5", "4,5", "3,6"]);
    expect(rings).toHaveLength(1);
    expect(cornerCount(rings[0])).toBe(6);
  });

  it("traces disjoint areas as separate rings", () => {
    const rings = ringsFor(["1,1", "8,8"]);
    expect(rings).toHaveLength(2);
    expect(cornerCount(rings[0])).toBe(4);
    expect(cornerCount(rings[1])).toBe(4);
  });

  it("traces a donut as outer ring plus hole ring", () => {
    // 3x3 block with the center missing
    const cells = [];
    for (let x = 3; x <= 5; x++) {
      for (let y = 3; y <= 5; y++) {
        if (!(x === 4 && y === 4)) cells.push(`${x},${y}`);
      }
    }
    const rings = ringsFor(cells);
    expect(rings).toHaveLength(2);
    const counts = rings.map(cornerCount).sort((a, b) => a - b);
    expect(counts).toEqual([4, 4]); // square outer + square hole
  });
});

describe("footprintFromCells (multi-zoom union)", () => {
  it("covers charts that only exist at different zoom levels", () => {
    // Packed archive: chart A native z6 at one place, chart B native z8
    // elsewhere. A single-zoom trace would miss one of them entirely.
    const byZoom = new Map<number, Set<string>>([
      [6, new Set(["10,10"])],
      [8, new Set(["50,50"])],
    ]);
    const rings = footprintFromCells(byZoom);
    expect(rings).not.toBeNull();
    // Two disjoint areas → two rings
    expect(rings).toHaveLength(2);
  });

  it("merges overview cells with their own chart's deep cells", () => {
    // One chart: overview cell at z6 (10,10) whose area contains its z8
    // native cells (40..43, 40..43) — union must be one blob, not nested
    const z8 = new Set<string>();
    for (let x = 40; x <= 43; x++) {
      for (let y = 40; y <= 43; y++) z8.add(`${x},${y}`);
    }
    const rings = footprintFromCells(
      new Map([
        [6, new Set(["10,10"])],
        [8, z8],
      ]),
    );
    expect(rings).toHaveLength(1);
  });

  it("returns null for an empty map", () => {
    expect(footprintFromCells(new Map())).toBeNull();
  });
});
