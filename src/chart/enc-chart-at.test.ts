import { describe, expect, it } from "vitest";
import { encChartAt, type RenderedChartFeature } from "./enc-chart-at";

const NOAA = "s57-vector-gulf-coast";
const RIVER = "s57-vector-inland-rivers-south";

function feature(
  source: string,
  type: string,
  properties: Record<string, unknown>,
): RenderedChartFeature {
  return { source, layer: { type }, properties };
}

const noaaSounding = feature(NOAA, "symbol", { AGEN: 550, _cell_id: "N1" });
const noaaDepth = feature(NOAA, "fill", { AGEN: 550, _cell_id: "N1" });
const riverDepth = feature(RIVER, "fill", {
  AGEN: 553,
  _cell_id: "U37AT046",
  _sdat: 31,
});
const riverLand = feature(RIVER, "fill", { AGEN: 553, _cell_id: "U37AT046" });

describe("encChartAt", () => {
  it("takes the chart of the topmost fill, not a symbol drawn above it", () => {
    const at = encChartAt([noaaSounding, riverDepth, noaaDepth], []);
    expect(at?.feature).toBe(riverDepth);
    expect(at?.sdat).toBe(31);
  });

  it("names no river datum on a NOAA chart beside a river chart", () => {
    const at = encChartAt([noaaDepth], [riverDepth, noaaDepth]);
    expect(at?.feature).toBe(noaaDepth);
    expect(at?.sdat).toBeUndefined();
  });

  it("finds the datum on the same chart's features nearby", () => {
    const otherRiver = feature(RIVER, "fill", {
      _cell_id: "U37LM236",
      _sdat: 41,
    });
    const at = encChartAt([riverLand], [otherRiver, riverDepth]);
    expect(at?.feature).toBe(riverLand);
    expect(at?.sdat).toBe(31);
  });

  it("falls back to the topmost ENC feature nearby without a fill", () => {
    const raster = feature("rnc-bvi", "raster", {});
    expect(encChartAt([raster], [raster, noaaSounding])?.feature).toBe(
      noaaSounding,
    );
    expect(encChartAt([raster], [raster])).toBeNull();
  });
});
