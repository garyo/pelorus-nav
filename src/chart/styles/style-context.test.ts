import {
  expression,
  type LayerSpecification,
  latest,
  type StylePropertySpecification,
} from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { chartDepthText, type DepthUnit } from "../../settings";
import { getClearanceLabelLayers, getLineLayers } from "./layers/lines";
import { getTextLayers } from "./layers/text";
import {
  createStyleContext,
  depthTextField,
  lightLabelTextField,
} from "./style-context";

function evaluateText(
  field: unknown,
  properties: Record<string, unknown>,
): string {
  const result = expression.createExpression(
    field,
    latest.layout_symbol["text-field"] as StylePropertySpecification,
  );
  if (result.result === "error") {
    throw new Error(result.value.map((e) => e.message).join("; "));
  }
  return String(
    result.value.evaluate({ zoom: 14 }, { type: "Point", properties }),
  );
}

/** The text-field of a built layer, evaluated for a feature's properties. */
function layerText(
  layers: (ctxUnit: DepthUnit) => LayerSpecification[],
  id: string,
  unit: DepthUnit,
  properties: Record<string, unknown>,
): string {
  const layer = layers(unit).find((l) => l.id === id);
  if (layer?.type !== "symbol") throw new Error(`no symbol layer ${id}`);
  return evaluateText(layer.layout?.["text-field"], properties);
}

function ctxFor(unit: DepthUnit) {
  return createStyleContext({
    sourceId: "test-source",
    depthUnit: unit,
    detailOffset: 1,
    layerGroups: {},
    theme: "day",
  });
}

const lineLayers = (unit: DepthUnit) => getLineLayers(ctxFor(unit));
const clearanceLayers = (unit: DepthUnit) =>
  getClearanceLabelLayers(ctxFor(unit));
const textLayers = (unit: DepthUnit) => getTextLayers(ctxFor(unit));

describe("depthTextField", () => {
  it("labels NOAA's truncated foot soundings with the shoaler whole foot", () => {
    expect(evaluateText(depthTextField("feet"), { DEPTH: 11.2 })).toBe("36"); // 36.75 ft
    expect(evaluateText(depthTextField("feet"), { DEPTH: 1.2 })).toBe("3"); // 3.94 ft
  });

  it("reads ½ for a sounding under a foot, as NOAA Custom Chart does", () => {
    const ft = (DEPTH: number) =>
      evaluateText(depthTextField("feet"), { DEPTH });
    expect(ft(0.1)).toBe("½");
    expect(ft(0.3)).toBe("½"); // 0.98 ft
    expect(ft(0.4)).toBe("1"); // 1.31 ft
    expect(ft(0)).toBe("0");
    expect(ft(-0.3)).toBe("-1"); // drying: rounded to the higher drying height
  });

  it("matches chartDepthText in every unit", () => {
    const units: DepthUnit[] = ["feet", "meters", "fathoms"];
    for (const unit of units) {
      for (const depth of [0, 0.2, 0.9, 1.8, 2.3, 4.5, 11.2, 18.2, 91.4]) {
        // The expression prints whole numbers without a trailing ".0".
        expect(evaluateText(depthTextField(unit), { DEPTH: depth })).toBe(
          chartDepthText(depth, unit).replace(/\.0$/, ""),
        );
      }
    }
  });
});

describe("depth contour labels", () => {
  it("truncate like soundings, as NOAA's charts do", () => {
    // NOAA's 6 / 12 / 18 ft contours are stored as 1.8 / 3.6 / 5.4 m.
    const label = (unit: DepthUnit, VALDCO: number) =>
      layerText(lineLayers, "s57-depcnt-label", unit, { VALDCO });
    expect(label("feet", 1.8)).toBe("5ft");
    expect(label("feet", 3.6)).toBe("11ft");
    expect(label("feet", 5.4)).toBe("17ft");
    expect(label("fathoms", 5.4)).toBe("2.9fm");
    expect(label("meters", 1.8)).toBe("1.8");
    expect(label("feet", 0)).toBe("0ft");
  });
});

describe("heights and clearances", () => {
  it("show tenths of a foot for feet and fathom settings, truncated", () => {
    const clr = (unit: DepthUnit, props: Record<string, unknown>) =>
      layerText(clearanceLayers, "s57-bridge-label", unit, props);
    expect(clr("feet", { VERCLR: 53.3 })).toBe("clr 174.8ft"); // 174.87 ft
    expect(clr("fathoms", { VERCLR: 53.3 })).toBe("clr 174.8ft");
    expect(clr("meters", { VERCLR: 53.3 })).toBe("clr 53.3m");
    expect(clr("feet", { VERCCL: 3.1, VERCOP: 41.1 })).toBe("clr 10.1/134.8ft");
  });

  it("truncate light heights", () => {
    const light = (unit: DepthUnit) =>
      evaluateText(lightLabelTextField(unit), {
        LABEL: "Fl G 4s",
        HEIGHT: 4.8, // 15.75 ft
        VALNMR: 5,
      });
    expect(light("feet")).toBe("Fl G 4s 15ft5M");
    expect(light("fathoms")).toBe("Fl G 4s 15ft5M");
    expect(light("meters")).toBe("Fl G 4s 4.8m5M");
  });

  it("truncate elevations, in feet for fathom settings", () => {
    const elev = (unit: DepthUnit) =>
      layerText(textLayers, "s57-lndelv-label", unit, { ELEVAT: 30 }); // 98.43 ft
    expect(elev("feet")).toBe("98 ft");
    expect(elev("fathoms")).toBe("98 ft");
    expect(elev("meters")).toBe("30 m");
  });
});
