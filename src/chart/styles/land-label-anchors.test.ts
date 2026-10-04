import {
  expression,
  latest,
  type StylePropertySpecification,
  validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { getNauticalLayers } from "./index";
import {
  type AnchorCode,
  anchorHintValues,
  LAND_LABEL_ANCHOR_CODES,
  LAND_LABEL_HINT_BANDS,
  landLabelAnchorOffset,
  landLabelTextField,
  radialAnchorOffset,
  type TextAnchor,
} from "./land-label-anchors";
import { VARIABLE_ANCHOR_LAYOUT } from "./style-context";

type Props = Record<string, string>;
type Geometry = "Point" | "Polygon";

const symbolLayout = latest.layout_symbol as Record<
  string,
  StylePropertySpecification
>;

function compile(value: unknown, property: string) {
  const result = expression.createPropertyExpression(
    value,
    symbolLayout[property],
  );
  if (result.result === "error") {
    throw new Error(result.value.map((e) => e.message).join("; "));
  }
  return result.value;
}

const anchorOffsetExpr = compile(
  landLabelAnchorOffset(),
  "text-variable-anchor-offset",
);
const textFieldExpr = compile(
  landLabelTextField(["get", "OBJNAM"]),
  "text-field",
);

function feature(geometry: Geometry, properties: Props) {
  return { type: geometry, properties };
}

/** Anchors (in order) that the layer tries for a feature at `zoom`. */
function anchorsAt(zoom: number, geometry: Geometry, props: Props): string[] {
  const collection = anchorOffsetExpr.evaluate(
    { zoom },
    feature(geometry, props),
  ) as { values: (string | [number, number])[] };
  return collection.values.filter((v): v is string => typeof v === "string");
}

function offsetsAt(
  zoom: number,
  geometry: Geometry,
  props: Props,
): (string | [number, number])[] {
  return (
    anchorOffsetExpr.evaluate({ zoom }, feature(geometry, props)) as {
      values: (string | [number, number])[];
    }
  ).values;
}

function textAt(zoom: number, props: Props): string {
  return String(
    textFieldExpr.evaluate({ zoom }, feature("Polygon", props)) ?? "",
  );
}

const RING = VARIABLE_ANCHOR_LAYOUT["text-variable-anchor"];

describe("anchor code table", () => {
  it("maps each code to its MapLibre anchor", () => {
    expect(LAND_LABEL_ANCHOR_CODES).toEqual({
      C: "center",
      T: "top",
      B: "bottom",
      L: "left",
      R: "right",
      TL: "top-left",
      TR: "top-right",
      BL: "bottom-left",
      BR: "bottom-right",
    });
  });

  it("lists every single code and every ordered pair", () => {
    const values = anchorHintValues().map((codes) => codes.join(","));
    expect(values).toHaveLength(9 + 9 * 8);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain("TR,R");
    expect(values).toContain("R,TR");
  });
});

describe("radialAnchorOffset", () => {
  // Em equivalents of MapLibre's fromRadialOffset (variable_text_anchor.ts);
  // MapLibre applies the same baseline shift to both forms.
  const r = 1.5;
  const h = r / Math.SQRT2;
  const expected: Record<TextAnchor, [number, number]> = {
    center: [0, 0],
    top: [0, r],
    bottom: [0, -r],
    left: [r, 0],
    right: [-r, 0],
    "top-left": [h, h],
    "top-right": [-h, h],
    "bottom-left": [h, -h],
    "bottom-right": [-h, -h],
  };

  for (const [anchor, offset] of Object.entries(expected)) {
    it(`matches MapLibre's radial conversion for ${anchor}`, () => {
      expect(radialAnchorOffset(anchor as TextAnchor, r)).toEqual(offset);
    });
  }
});

describe("landLabelAnchorOffset", () => {
  it("places hinted anchors in order with ring offsets, in every band", () => {
    for (const codes of anchorHintValues()) {
      const anchors = codes.map((c: AnchorCode) => LAND_LABEL_ANCHOR_CODES[c]);
      for (const band of LAND_LABEL_HINT_BANDS) {
        const props = { [`_la${band}`]: codes.join(",") };
        expect(offsetsAt(band, "Polygon", props)).toEqual(
          anchors.flatMap((a) => [a, radialAnchorOffset(a, 1.5)]),
        );
      }
    }
  });

  it("reads the hint for the current zoom band", () => {
    const props = { _la11: "L", _la12: "R", _la14: "T", _la16: "B" };
    expect(anchorsAt(9, "Polygon", props)).toEqual(["left"]);
    expect(anchorsAt(11.9, "Polygon", props)).toEqual(["left"]);
    expect(anchorsAt(12, "Polygon", props)).toEqual(["right"]);
    expect(anchorsAt(14.5, "Polygon", props)).toEqual(["top"]);
    expect(anchorsAt(18, "Polygon", props)).toEqual(["bottom"]);
  });

  it("uses centre then the ring for an unconstrained polygon, the ring for a point", () => {
    expect(anchorsAt(13, "Polygon", { _la13: "*" })).toEqual([
      "center",
      ...RING,
    ]);
    expect(anchorsAt(13, "Point", { _la13: "*" })).toEqual(RING);
  });

  it("falls back to centre-only polygons and ring points without hints", () => {
    expect(anchorsAt(13, "Polygon", {})).toEqual(["center"]);
    expect(anchorsAt(13, "Point", {})).toEqual(RING);
    expect(offsetsAt(13, "Point", {})).toEqual(
      RING.flatMap((a) => [a, radialAnchorOffset(a, 1.5)]),
    );
  });
});

describe("landLabelTextField", () => {
  it("hides the name only in bands hinted '-'", () => {
    const props = { OBJNAM: "Gooseberry Island", _la12: "-", _la13: "*" };
    expect(textAt(12.5, props)).toBe("");
    expect(textAt(13, props)).toBe("Gooseberry Island");
    expect(textAt(11, props)).toBe("Gooseberry Island");
  });

  it("shows the name when hints are absent", () => {
    expect(textAt(14, { OBJNAM: "Hope Island" })).toBe("Hope Island");
  });
});

describe("s57-lndare-label layer", () => {
  const layer = getNauticalLayers({
    sourceId: "test-source",
    detailOffset: 1,
  }).find((l) => l.id === "s57-lndare-label");

  it("validates against the MapLibre style spec", () => {
    expect(layer).toBeDefined();
    const errors = validateStyleMin({
      version: 8,
      glyphs: "https://example.com/{fontstack}/{range}.pbf",
      sources: {
        "test-source": {
          type: "vector",
          tiles: ["https://example.com/{z}/{x}/{y}.pbf"],
        },
      },
      layers: layer ? [layer] : [],
    });
    expect(errors).toEqual([]);
  });

  it("keeps the anchor-offset expression a reasonable size", () => {
    const bytes = JSON.stringify(landLabelAnchorOffset()).length;
    expect(bytes).toBeLessThan(64_000);
  });
});
