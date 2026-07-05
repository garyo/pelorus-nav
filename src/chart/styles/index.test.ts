/**
 * Registry invariants for the nautical layer style system.
 *
 * getNauticalLayers() drives per-group visibility toggles (LAYER_GROUPS) and
 * detail-level filtering (LAYER_CATEGORIES) from two lookup tables keyed by
 * layer id. Nothing enforces that a newly-added layer gets registered in
 * either table, so a sibling layer (e.g. an icon/arrow symbol drawn atop an
 * existing area/line from the same S-57 source-layer) can be added without
 * ever being wired into the group toggle or STANDARD detail filter its
 * "parent" layer already respects (see Chart-3: s57-achare-symbol and
 * s57-tsslpt-arrow shipped without either).
 *
 * This test catches that class of bug: for any source-layer where at least
 * one produced layer id is fully wired into both tables, every other layer
 * id drawn from that same source-layer must be too.
 */
import { describe, expect, it } from "vitest";
import { getNauticalLayers, LAYER_CATEGORIES, LAYER_GROUPS } from "./index";

describe("layer registry invariants", () => {
  // detailOffset=1 turns on both the STANDARD and OTHER display categories
  // (see createStyleContext), so every layer id getNauticalLayers can ever
  // produce shows up here, regardless of a user's current detail-level
  // setting.
  const layers = getNauticalLayers("test-source", "meters", 1, {});

  it("produces at least one layer (sanity check)", () => {
    expect(layers.length).toBeGreaterThan(50);
  });

  it("wires every layer from a fully-wired source-layer into both LAYER_CATEGORIES and LAYER_GROUPS", () => {
    const bySourceLayer = new Map<string, string[]>();
    for (const layer of layers) {
      const sourceLayer = (layer as { "source-layer"?: string })[
        "source-layer"
      ];
      if (sourceLayer === undefined) continue;
      const ids = bySourceLayer.get(sourceLayer) ?? [];
      ids.push(layer.id);
      bySourceLayer.set(sourceLayer, ids);
    }

    // A source-layer's "primary" layer is the one whose id is the plain
    // `s57-<source-layer>` form (e.g. s57-achare for ACHARE) — the base
    // area/line rendering that any icon, arrow, or other overlay for the
    // same feature is drawn alongside. Once the primary is fully wired
    // (registered in both tables), every other layer sharing its
    // source-layer must be too: they depict the same feature and must
    // obey the same group toggle and detail-level filter. Layers with no
    // primary in their source-layer bucket (e.g. a label with its own,
    // independently-toggleable group) are a deliberate separate design
    // and aren't held to this rule.
    const violations: string[] = [];
    for (const [sourceLayer, ids] of bySourceLayer) {
      if (ids.length < 2) continue;
      const primaryId = `s57-${sourceLayer.toLowerCase()}`;
      if (!ids.includes(primaryId)) continue;

      const primaryFullyWired =
        LAYER_CATEGORIES[primaryId] !== undefined &&
        LAYER_GROUPS[primaryId] !== undefined;
      if (!primaryFullyWired) continue;

      for (const id of ids) {
        if (LAYER_CATEGORIES[id] === undefined) {
          violations.push(`${id}: missing from LAYER_CATEGORIES`);
        }
        if (LAYER_GROUPS[id] === undefined) {
          violations.push(`${id}: missing from LAYER_GROUPS`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("hides s57-achare-symbol and s57-tsslpt-arrow when their group is toggled off", () => {
    const anchorageOff = getNauticalLayers("test-source", "meters", 1, {
      anchorage: false,
    });
    const routingOff = getNauticalLayers("test-source", "meters", 1, {
      routing: false,
    });

    const visibility = (set: typeof layers, id: string): string | undefined => {
      const layer = set.find((l) => l.id === id);
      return (layer?.layout as { visibility?: string } | undefined)?.visibility;
    };

    expect(visibility(anchorageOff, "s57-achare")).toBe("none");
    expect(visibility(anchorageOff, "s57-achare-symbol")).toBe("none");
    expect(visibility(routingOff, "s57-tsslpt")).toBe("none");
    expect(visibility(routingOff, "s57-tsslpt-arrow")).toBe("none");
  });

  it("hides s57-achare-symbol and s57-tsslpt-arrow at DISPLAYBASE detail (STANDARD filter off)", () => {
    // detailOffset=-1 → showStandard=false, so STANDARD-category layers
    // (including these two, once registered) must be filtered out.
    const displayBaseOnly = getNauticalLayers("test-source", "meters", -1, {});
    const ids = new Set(displayBaseOnly.map((l) => l.id));
    expect(ids.has("s57-achare-symbol")).toBe(false);
    expect(ids.has("s57-tsslpt-arrow")).toBe(false);
  });
});
