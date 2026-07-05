import type { Feature, Point } from "geojson";
import { describe, expect, it } from "vitest";
import { sectorLightsSignature } from "./LightSectorLayer";

function light(
  props: Record<string, unknown>,
  coords: [number, number] = [-70.6743, 41.6925],
): Feature<Point> {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: coords },
    properties: props,
  };
}

function sampleLights(): Feature[] {
  return [
    light({ LNAM: "A", SECTR1: 10, SECTR2: 20, COLOUR: "3", VALNMR: 8 }),
    light(
      { LNAM: "B", SECTR1: 20, SECTR2: 30, COLOUR: "4", VALNMR: 8 },
      [-70.6, 41.7],
    ),
  ];
}

describe("sectorLightsSignature", () => {
  it("is identical for the same features and zoom queried again", () => {
    const a = sectorLightsSignature(sampleLights(), 12);
    const b = sectorLightsSignature(sampleLights(), 12);
    expect(a).toBe(b);
  });

  it("is order-independent (same set, different query order)", () => {
    const a = sectorLightsSignature(sampleLights(), 12);
    const b = sectorLightsSignature([...sampleLights()].reverse(), 12);
    expect(a).toBe(b);
  });

  it("changes when a feature is added or removed", () => {
    const full = sectorLightsSignature(sampleLights(), 12);
    const partial = sectorLightsSignature(sampleLights().slice(0, 1), 12);
    expect(full).not.toBe(partial);
  });

  it("changes when a geometry-affecting attribute changes", () => {
    const before = sectorLightsSignature(sampleLights(), 12);
    const feats = sampleLights();
    (feats[0].properties as Record<string, unknown>).SECTR1 = 999;
    const after = sectorLightsSignature(feats, 12);
    expect(before).not.toBe(after);
  });

  it("changes on any zoom difference, since the arc radius is continuous in zoom", () => {
    const a = sectorLightsSignature(sampleLights(), 12);
    const b = sectorLightsSignature(sampleLights(), 12.001);
    expect(a).not.toBe(b);
  });
});
