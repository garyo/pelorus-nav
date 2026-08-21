/**
 * Icon-size scaling invariants for the layer builders.
 *
 * Every symbol layer's icon-size must go through scaledIconSize() so the
 * user's Icon-size setting (createStyleContext's iconScale) and per-theme
 * boosts (e-ink ships a 1.5x scheme scale) apply chart-wide. A hard-coded
 * literal silently ignores both — the bug class these tests pin down.
 */
import { describe, expect, it } from "vitest";
import type { StyleContext } from "../style-context";
import { createStyleContext } from "../style-context";
import { evalExpr } from "../test-helpers";
import { getAdditionalAreaLayers, getAreaLayers } from "./areas";
import {
  getAdditionalLineLayers,
  getLineLayers,
  getOtherLineLayers,
} from "./lines";
import {
  getNavigationOverlayLayers,
  getNavigationRoutingLayers,
} from "./navigation";
import {
  getAdditionalPointLayers,
  getBuoyBeaconLayers,
  getDaymarkTopmarkLayers,
  getHazardLayers,
  getNavAidLayers,
  getOtherNavAidLayers,
  getOtherPointLayers,
} from "./points";
import { getTextLayers } from "./text";

const BUILDERS = [
  getNavAidLayers,
  getBuoyBeaconLayers,
  getHazardLayers,
  getOtherNavAidLayers,
  getOtherPointLayers,
  getAdditionalPointLayers,
  getDaymarkTopmarkLayers,
  getAreaLayers,
  getAdditionalAreaLayers,
  getLineLayers,
  getAdditionalLineLayers,
  getOtherLineLayers,
  getNavigationOverlayLayers,
  getNavigationRoutingLayers,
  getTextLayers,
];

function makeCtx(theme: "day" | "eink", iconScale: number): StyleContext {
  // detailOffset=1 enables both STANDARD and OTHER categories so every
  // buildable layer is present.
  return createStyleContext(
    "test-source",
    "meters",
    1,
    {},
    theme,
    "test-coverage",
    "iho-s52",
    5,
    5,
    20,
    1,
    iconScale,
  );
}

interface SymbolLayerLite {
  id: string;
  layout?: Record<string, unknown>;
}

function allLayers(ctx: StyleContext): SymbolLayerLite[] {
  return BUILDERS.flatMap((build) => build(ctx)) as SymbolLayerLite[];
}

function iconSizeOf(layers: SymbolLayerLite[], id: string): unknown {
  const layer = layers.find((l) => l.id === id);
  if (!layer) throw new Error(`layer ${id} not found`);
  return layer.layout?.["icon-size"];
}

describe("icon-size scaling", () => {
  const base = allLayers(makeCtx("day", 1));
  const doubled = allLayers(makeCtx("day", 2));

  it("finds a healthy number of icon-bearing layers (sanity check)", () => {
    const withIcons = base.filter((l) => l.layout?.["icon-size"] !== undefined);
    expect(withIcons.length).toBeGreaterThan(50);
  });

  it("scales every symbol layer's icon-size with the user's icon scale", () => {
    for (const layer of base) {
      const size = layer.layout?.["icon-size"];
      if (size === undefined) continue;
      const scaled = iconSizeOf(doubled, layer.id);
      if (typeof size === "number") {
        expect(scaled, layer.id).toBeCloseTo(size * 2, 10);
      } else {
        // Expression-valued (interpolate/step): the scaled variant must
        // differ — identical output means the scale never entered.
        expect(JSON.stringify(scaled), layer.id).not.toBe(JSON.stringify(size));
      }
    }
  });

  it("applies the scale to formerly hard-coded layers", () => {
    // Each of these carried a literal icon-size before scaledIconSize()
    // was applied; base sizes preserved from those literals.
    const cases: [string, number][] = [
      ["s57-achare-symbol", 0.8], // navigation.ts anchorage
      ["s57-resare-entry-prohib", 0.5], // navigation.ts restricted area
      ["s57-tsslpt-arrow", 0.7], // navigation.ts TSS arrow
      ["s57-wedklp", 0.7], // points.ts kelp
      ["s57-curent", 0.7], // points.ts current arrow
      ["s57-litflt", 0.8], // points.ts light float
      ["s57-rdosta", 0.7], // points.ts radio station
      ["s57-bridge-opening", 0.7], // lines.ts opening bridge
      ["s57-forstc-symbol", 0.7], // areas.ts fortified structure
      ["s57-lndelv-label", 1.0], // text.ts land elevation
      ["s57-buisgl-functn", 0.6], // text.ts building function icons
    ];
    for (const [id, baseSize] of cases) {
      expect(iconSizeOf(base, id), id).toBeCloseTo(baseSize, 10);
      expect(iconSizeOf(doubled, id), id).toBeCloseTo(baseSize * 2, 10);
    }
  });

  it("keeps default rendering unchanged (scale 1, day theme)", () => {
    expect(iconSizeOf(base, "s57-wedklp")).toBe(0.7);
    expect(iconSizeOf(base, "s57-achare-symbol")).toBe(0.8);
    expect(iconSizeOf(base, "s57-lndelv-label")).toBe(1.0);
  });

  it("applies the e-ink theme's 1.5x scheme boost", () => {
    const eink = allLayers(makeCtx("eink", 1));
    expect(iconSizeOf(eink, "s57-wedklp")).toBeCloseTo(0.7 * 1.5, 10);
    expect(iconSizeOf(eink, "s57-achare-symbol")).toBeCloseTo(0.8 * 1.5, 10);
  });
});

describe("RDOSTA DGPS label (list-typed CATROS)", () => {
  const layers = allLayers(makeCtx("day", 1));
  const textField = layers.find((l) => l.id === "s57-rdosta")?.layout?.[
    "text-field"
  ];

  const label = (props: Record<string, unknown>): unknown =>
    evalExpr(textField, props);

  it("tags DGPS for single- and multi-valued CATROS", () => {
    expect(label({ CATROS: 7 })).toBe("DGPS");
    expect(label({ CATROS: "7" })).toBe("DGPS");
    expect(label({ CATROS: "7,10" })).toBe("DGPS");
    expect(label({ CATROS: "10,7" })).toBe("DGPS");
  });

  it("shows nothing for other station types or codes containing 7", () => {
    expect(label({ CATROS: 17 })).toBe("");
    expect(label({ CATROS: "1,17" })).toBe("");
    expect(label({})).toBe("");
  });
});
