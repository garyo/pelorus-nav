/**
 * Tests for icon set mappings and buildLayerExpressions().
 *
 * Since MapLibre expressions can't run in Node, we test:
 * 1. Icon set completeness — all semantic keys present in all sets
 * 2. Expression structure — known attribute combos via a mini expression evaluator
 */

import { describe, expect, it } from "vitest";
import {
  IHO_S52,
  PELORUS_STANDARD,
  SIMPLIFIED_MINIMAL,
} from "./icon-sets";
import { resolveIcon } from "./test-helpers";

// ── Icon set completeness ──────────────────────────────────────────────

/** All semantic icon keys used by buildLayerExpressions. */
const REQUIRED_KEYS = [
  // Lateral buoys
  "lateral-port-conical",
  "lateral-stbd-conical",
  "lateral-port-can",
  "lateral-stbd-can",
  "lateral-port-pillar",
  "lateral-stbd-pillar",
  "lateral-port-spar",
  "lateral-stbd-spar",
  "lateral-port-spherical",
  "lateral-stbd-spherical",
  // Preferred channel
  "preferred-port",
  "preferred-stbd",
  // Special buoys
  "safewater",
  "special",
  "special-conical",
  "special-can",
  "special-pillar",
  "special-wo",
  "superbuoy",
  "isolated-danger",
  // Cardinal
  "cardinal-n",
  "cardinal-s",
  "cardinal-e",
  "cardinal-w",
  // Beacons
  "beacon-port",
  "beacon-stbd",
  "beacon-cardinal",
  "beacon-default",
  // Lights
  "light-major-red",
  "light-minor-red",
  "light-major-green",
  "light-minor-green",
  "light-major-white",
  "light-minor-white",
];

describe("icon set completeness", () => {
  for (const [name, set] of [
    ["PELORUS_STANDARD", PELORUS_STANDARD],
    ["IHO_S52", IHO_S52],
    ["SIMPLIFIED_MINIMAL", SIMPLIFIED_MINIMAL],
  ] as const) {
    describe(name, () => {
      for (const key of REQUIRED_KEYS) {
        it(`has "${key}"`, () => {
          expect(set[key]).toBeDefined();
          expect(typeof set[key]).toBe("string");
          expect(set[key].length).toBeGreaterThan(0);
        });
      }
    });
  }
});

// ── S-52 sprite shape correctness ──────────────────────────────────────

describe("S-52 lateral buoy sprite shapes", () => {
  it("can-shaped buoys use rectangular sprites (BOYLAT23/24)", () => {
    expect(IHO_S52["lateral-port-can"]).toBe("BOYLAT23");
    expect(IHO_S52["lateral-stbd-can"]).toBe("BOYLAT24");
  });

  it("conical buoys use triangular sprites (BOYLAT13/14)", () => {
    expect(IHO_S52["lateral-port-conical"]).toBe("BOYLAT13");
    expect(IHO_S52["lateral-stbd-conical"]).toBe("BOYLAT14");
  });

  it("pillar buoys use rectangular sprites (BOYLAT23/24)", () => {
    expect(IHO_S52["lateral-port-pillar"]).toBe("BOYLAT23");
    expect(IHO_S52["lateral-stbd-pillar"]).toBe("BOYLAT24");
  });

  it("can and conical use different sprites", () => {
    expect(IHO_S52["lateral-port-can"]).not.toBe(
      IHO_S52["lateral-port-conical"],
    );
    expect(IHO_S52["lateral-stbd-can"]).not.toBe(
      IHO_S52["lateral-stbd-conical"],
    );
  });
});

describe("S-52 special buoy sprite shapes", () => {
  it("special-can uses BOYSPP25 (wide/rectangular)", () => {
    expect(IHO_S52["special-can"]).toBe("BOYSPP25");
  });

  it("special-pillar uses BOYSPP35 (tall/narrow)", () => {
    expect(IHO_S52["special-pillar"]).toBe("BOYSPP35");
  });

  it("special-conical uses BOYSPP15", () => {
    expect(IHO_S52["special-conical"]).toBe("BOYSPP15");
  });

  it("can and pillar are different sprites", () => {
    expect(IHO_S52["special-can"]).not.toBe(IHO_S52["special-pillar"]);
  });
});

// ── BOYLAT icon resolution ─────────────────────────────────────────────

describe("BOYLAT icon resolution", () => {
  it("port can buoy → BOYLAT23 (rectangular green)", () => {
    expect(resolveIcon("BOYLAT", { CATLAM: 1, BOYSHP: 2 })).toBe("BOYLAT23");
  });

  it("port conical buoy → BOYLAT13 (triangular green)", () => {
    expect(resolveIcon("BOYLAT", { CATLAM: 1, BOYSHP: 1 })).toBe("BOYLAT13");
  });

  it("port pillar buoy → BOYLAT23 (rectangular green)", () => {
    expect(resolveIcon("BOYLAT", { CATLAM: 1, BOYSHP: 4 })).toBe("BOYLAT23");
  });

  it("port spar buoy → BOYLAT23 (rectangular green)", () => {
    expect(resolveIcon("BOYLAT", { CATLAM: 1, BOYSHP: 5 })).toBe("BOYLAT23");
  });

  it("starboard can buoy → BOYLAT24 (rectangular red)", () => {
    expect(resolveIcon("BOYLAT", { CATLAM: 2, BOYSHP: 2 })).toBe("BOYLAT24");
  });

  it("starboard conical buoy → BOYLAT14 (triangular red)", () => {
    expect(resolveIcon("BOYLAT", { CATLAM: 2, BOYSHP: 1 })).toBe("BOYLAT14");
  });

  it("starboard pillar buoy → BOYLAT24 (rectangular red)", () => {
    expect(resolveIcon("BOYLAT", { CATLAM: 2, BOYSHP: 4 })).toBe("BOYLAT24");
  });

  it("port with no BOYSHP defaults to can (IALA-B) → BOYLAT23", () => {
    expect(resolveIcon("BOYLAT", { CATLAM: 1 })).toBe("BOYLAT23");
  });

  it("starboard with no BOYSHP defaults to conical (IALA-B) → BOYLAT14", () => {
    expect(resolveIcon("BOYLAT", { CATLAM: 2 })).toBe("BOYLAT14");
  });
});

// ── Preferred channel buoys ────────────────────────────────────────────

describe("BOYLAT preferred channel icon resolution", () => {
  it("CATLAM=3 (pref stbd, green dominant) pillar → green rectangular", () => {
    expect(resolveIcon("BOYLAT", { CATLAM: 3, BOYSHP: 4 })).toBe("BOYLAT23");
  });

  it("CATLAM=3 (pref stbd, green dominant) conical → green triangular", () => {
    expect(resolveIcon("BOYLAT", { CATLAM: 3, BOYSHP: 1 })).toBe("BOYLAT13");
  });

  it("CATLAM=4 (pref port, red dominant) pillar → red rectangular", () => {
    expect(resolveIcon("BOYLAT", { CATLAM: 4, BOYSHP: 4 })).toBe("BOYLAT24");
  });

  it("CATLAM=4 (pref port, red dominant) conical → red triangular", () => {
    expect(resolveIcon("BOYLAT", { CATLAM: 4, BOYSHP: 1 })).toBe("BOYLAT14");
  });

  // Colour-based preferred channel detection (no CATLAM)
  it("green-red colour pattern → green shape (port set)", () => {
    const icon = resolveIcon("BOYLAT", { COLOUR: "4,3", BOYSHP: 2 });
    expect(icon).toBe("BOYLAT23"); // port can = green rectangular
  });

  it("red-green colour pattern → red shape (stbd set)", () => {
    const icon = resolveIcon("BOYLAT", { COLOUR: "3,4", BOYSHP: 2 });
    expect(icon).toBe("BOYLAT24"); // stbd can = red rectangular
  });
});

// ── BOYSPP icon resolution ─────────────────────────────────────────────

describe("BOYSPP icon resolution", () => {
  it("white+orange → BOYSPP35 (pillar w/o)", () => {
    expect(resolveIcon("BOYSPP", { COLOUR: "1,11" })).toBe("BOYSPP35");
  });

  it("yellow can → BOYSPP25 (can shape)", () => {
    expect(resolveIcon("BOYSPP", { COLOUR: "6", BOYSHP: 2 })).toBe("BOYSPP25");
  });

  it("yellow pillar → BOYSPP35 (pillar shape)", () => {
    expect(resolveIcon("BOYSPP", { COLOUR: "6", BOYSHP: 4 })).toBe("BOYSPP35");
  });

  it("yellow conical → BOYSPP15 (conical shape)", () => {
    expect(resolveIcon("BOYSPP", { COLOUR: "6", BOYSHP: 1 })).toBe("BOYSPP15");
  });

  it("yellow spar → BOYSPP35 (pillar-type shape)", () => {
    expect(resolveIcon("BOYSPP", { COLOUR: "6", BOYSHP: 5 })).toBe("BOYSPP35");
  });

  it("no BOYSHP → BOYSPP11 (default spherical)", () => {
    expect(resolveIcon("BOYSPP", { COLOUR: "6" })).toBe("BOYSPP11");
  });

  it("superbuoy BOYSHP=7 → BOYSUP02", () => {
    expect(resolveIcon("BOYSPP", { COLOUR: "6", BOYSHP: 7 })).toBe("BOYSUP02");
  });
});

// ── Cardinal buoys ─────────────────────────────────────────────────────

describe("BOYCAR icon resolution", () => {
  it("CATCAM=1 → cardinal-n", () => {
    expect(resolveIcon("BOYCAR", { CATCAM: 1 })).toContain("BOYCAR");
  });

  it("CATCAM=2 → cardinal-s", () => {
    const n = resolveIcon("BOYCAR", { CATCAM: 1 });
    const s = resolveIcon("BOYCAR", { CATCAM: 2 });
    expect(n).not.toBe(s); // north and south must be different
  });
});

// ── LIGHTS ──────────────────────────────────────────────────────────────

describe("LIGHTS icon resolution", () => {
  it("green colour → LIGHTS12", () => {
    const icon = resolveIcon("LIGHTS", { COLOUR: "4", VALNMR: 5 });
    expect(icon).toBe("LIGHTS12");
  });

  it("red colour → LIGHTS11", () => {
    const icon = resolveIcon("LIGHTS", { COLOUR: "3", VALNMR: 5 });
    expect(icon).toBe("LIGHTS11");
  });

  it("white colour → LIGHTS13", () => {
    const icon = resolveIcon("LIGHTS", { COLOUR: "1", VALNMR: 5 });
    expect(icon).toBe("LIGHTS13");
  });

  it("no colour → LIGHTS13 (white default)", () => {
    const icon = resolveIcon("LIGHTS", { VALNMR: 5 });
    expect(icon).toBe("LIGHTS13");
  });

  it("different colours get different sprites", () => {
    const green = resolveIcon("LIGHTS", { COLOUR: "4" });
    const red = resolveIcon("LIGHTS", { COLOUR: "3" });
    const white = resolveIcon("LIGHTS", { COLOUR: "1" });
    expect(green).not.toBe(red);
    expect(green).not.toBe(white);
    expect(red).not.toBe(white);
  });

  // Pelorus set differentiates major/minor
  it("Pelorus: high VALNMR (>=10) → major light", () => {
    const icon = resolveIcon(
      "LIGHTS",
      { COLOUR: "3", VALNMR: 15 },
      PELORUS_STANDARD,
    );
    expect(icon).toContain("major");
  });

  it("Pelorus: low VALNMR (<10) → minor light", () => {
    const icon = resolveIcon(
      "LIGHTS",
      { COLOUR: "3", VALNMR: 5 },
      PELORUS_STANDARD,
    );
    expect(icon).toContain("minor");
  });
});

// ── Colour padding correctness ─────────────────────────────────────────
// These tests verify that the comma-padding approach doesn't false-match.

describe("colour expression correctness", () => {
  it("COLOUR '1' (white only) does not trigger white+orange match", () => {
    // White-only buoy: colContains(WHITE)=true, colContains(ORANGE)=false
    // Falls through to shape fallback
    const icon = resolveIcon("BOYSPP", { COLOUR: "1", BOYSHP: 2 });
    expect(icon).toBe("BOYSPP25"); // can shape, not special-wo
  });

  it("COLOUR '11' (orange only) does not trigger white+orange match", () => {
    const icon = resolveIcon("BOYSPP", { COLOUR: "11", BOYSHP: 2 });
    expect(icon).toBe("BOYSPP25"); // can shape, not special-wo
  });

  it("COLOUR '1,11' triggers white+orange match → BOYSPP35", () => {
    const icon = resolveIcon("BOYSPP", { COLOUR: "1,11" });
    expect(icon).toBe("BOYSPP35");
  });

  it("COLOUR '11,1' also matches white+orange (order independent)", () => {
    const icon = resolveIcon("BOYSPP", { COLOUR: "11,1" });
    expect(icon).toBe("BOYSPP35");
  });

  it("COLOUR '1' padding does not false-match '11'", () => {
    // ",1," in ",1," → true for WHITE
    // ",11," in ",1," → false for ORANGE (no false positive)
    // This verifies the comma-padding prevents substring false matches
    const iconWhiteOnly = resolveIcon("BOYSPP", { COLOUR: "1" });
    const iconOrangeOnly = resolveIcon("BOYSPP", { COLOUR: "11" });
    const iconBoth = resolveIcon("BOYSPP", { COLOUR: "1,11" });
    expect(iconBoth).toBe("BOYSPP35"); // special-wo
    expect(iconWhiteOnly).not.toBe("BOYSPP35");
    expect(iconOrangeOnly).not.toBe("BOYSPP35");
  });
});

// ── Pelorus Standard consistency ───────────────────────────────────────

describe("Pelorus Standard icon set", () => {
  it("can and conical port buoys have different sprites", () => {
    expect(PELORUS_STANDARD["lateral-port-can"]).not.toBe(
      PELORUS_STANDARD["lateral-port-conical"],
    );
  });

  it("can and conical stbd buoys have different sprites", () => {
    expect(PELORUS_STANDARD["lateral-stbd-can"]).not.toBe(
      PELORUS_STANDARD["lateral-stbd-conical"],
    );
  });

  it("port and stbd buoys have different sprites (can)", () => {
    expect(PELORUS_STANDARD["lateral-port-can"]).not.toBe(
      PELORUS_STANDARD["lateral-stbd-can"],
    );
  });

  it("port and stbd buoys have different sprites (conical)", () => {
    expect(PELORUS_STANDARD["lateral-port-conical"]).not.toBe(
      PELORUS_STANDARD["lateral-stbd-conical"],
    );
  });
});
