import { describe, expect, it } from "vitest";
import { NM_TO_METERS } from "../utils/units";
import { scaleUnitFor } from "./ChartScaleControl";

describe("scaleUnitFor", () => {
  it("uses nautical miles from 0.1 NM up with knots", () => {
    expect(scaleUnitFor(0.1 * NM_TO_METERS, "knots", "feet")).toBe("nautical");
    expect(scaleUnitFor(5000, "knots", "meters")).toBe("nautical");
  });

  it("drops to feet below 0.1 NM for feet and fathoms", () => {
    expect(scaleUnitFor(150, "knots", "feet")).toBe("imperial");
    expect(scaleUnitFor(150, "knots", "fathoms")).toBe("imperial");
  });

  it("drops to meters below 0.1 NM for meters", () => {
    expect(scaleUnitFor(150, "knots", "meters")).toBe("metric");
  });

  it("uses km/m at every scale with km/h", () => {
    expect(scaleUnitFor(5000, "kph", "feet")).toBe("metric");
    expect(scaleUnitFor(150, "kph", "meters")).toBe("metric");
  });

  it("uses mi/ft at every scale with mph", () => {
    expect(scaleUnitFor(5000, "mph", "meters")).toBe("imperial");
    expect(scaleUnitFor(150, "mph", "feet")).toBe("imperial");
  });
});
