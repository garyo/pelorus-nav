import { describe, expect, it } from "vitest";
import { convertSpeed, MS_TO_KNOTS, speedUnitLabel } from "./units";

describe("MS_TO_KNOTS", () => {
  it("converts 1 m/s to ~1.94384 knots", () => {
    expect(MS_TO_KNOTS).toBeCloseTo(1.94384, 5);
  });

  it("round-trips m/s -> knots -> m/s", () => {
    const ms = 5;
    const knots = ms * MS_TO_KNOTS;
    expect(knots / MS_TO_KNOTS).toBeCloseTo(ms, 10);
  });
});

describe("convertSpeed", () => {
  it("passes knots through unchanged for 'knots'", () => {
    expect(convertSpeed(10, "knots")).toBe(10);
  });

  it("converts knots to mph", () => {
    expect(convertSpeed(10, "mph")).toBeCloseTo(11.5078, 5);
  });

  it("converts knots to kph", () => {
    expect(convertSpeed(10, "kph")).toBeCloseTo(18.52, 5);
  });

  it("round-trips knots -> mph -> knots", () => {
    const knots = 12.3;
    const mph = convertSpeed(knots, "mph");
    expect(mph / 1.15078).toBeCloseTo(knots, 10);
  });

  it("round-trips knots -> kph -> knots", () => {
    const knots = 8.7;
    const kph = convertSpeed(knots, "kph");
    expect(kph / 1.852).toBeCloseTo(knots, 10);
  });

  it("treats zero the same in all units", () => {
    expect(convertSpeed(0, "knots")).toBe(0);
    expect(convertSpeed(0, "mph")).toBe(0);
    expect(convertSpeed(0, "kph")).toBe(0);
  });
});

describe("speedUnitLabel", () => {
  it("labels knots as 'Kt'", () => {
    expect(speedUnitLabel("knots")).toBe("Kt");
  });

  it("labels mph as 'mph'", () => {
    expect(speedUnitLabel("mph")).toBe("mph");
  });

  it("labels kph as 'km/h'", () => {
    expect(speedUnitLabel("kph")).toBe("km/h");
  });
});
