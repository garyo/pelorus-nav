import { describe, expect, it } from "vitest";
import {
  convertDistance,
  convertSpeed,
  distanceToNM,
  distanceUnitLabel,
  formatDistance,
  formatDistanceInSpeedUnits,
  formatDistanceShort,
  formatNavDistance,
  formatSpeed,
  MS_TO_KNOTS,
  speedToKnots,
  speedUnitLabel,
} from "./units";

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

describe("speedToKnots", () => {
  it("inverts convertSpeed", () => {
    for (const unit of ["knots", "mph", "kph"] as const) {
      expect(speedToKnots(convertSpeed(6.5, unit), unit)).toBeCloseTo(6.5, 10);
    }
  });
});

describe("formatSpeed", () => {
  it("formats one decimal with the unit label", () => {
    expect(formatSpeed(1.84, "knots")).toBe("1.8 Kt");
    expect(formatSpeed(10, "mph")).toBe("11.5 mph");
    expect(formatSpeed(10, "kph")).toBe("18.5 km/h");
  });
});

describe("convertDistance / distanceUnitLabel", () => {
  it("uses the speed unit's distance family", () => {
    expect(convertDistance(10, "knots")).toBe(10);
    expect(convertDistance(10, "mph")).toBeCloseTo(11.5078, 5);
    expect(convertDistance(10, "kph")).toBeCloseTo(18.52, 5);
    expect(distanceUnitLabel("knots")).toBe("NM");
    expect(distanceUnitLabel("mph")).toBe("mi");
    expect(distanceUnitLabel("kph")).toBe("km");
  });

  it("round-trips through distanceToNM", () => {
    for (const unit of ["knots", "mph", "kph"] as const) {
      expect(distanceToNM(convertDistance(3.2, unit), unit)).toBeCloseTo(
        3.2,
        10,
      );
    }
  });
});

describe("formatDistance", () => {
  it("formats two decimals in the speed unit's family at or above 0.1", () => {
    expect(formatDistance(0.1, "knots", "meters")).toBe("0.10 NM");
    expect(formatDistance(1.234, "knots", "meters")).toBe("1.23 NM");
    expect(formatDistance(12.4, "knots", "feet")).toBe("12.40 NM");
    expect(formatDistance(1, "mph", "feet")).toBe("1.15 mi");
    expect(formatDistance(1, "kph", "meters")).toBe("1.85 km");
  });

  it("switches to meters below 0.1 of the unit when depth unit is meters", () => {
    expect(formatDistance(0.05, "knots", "meters")).toBe(
      `${Math.round(0.05 * 1852)} m`,
    );
    expect(formatDistance(0.05, "kph", "meters")).toBe("93 m");
  });

  it("switches to feet below 0.1 of the unit when depth unit is feet or fathoms", () => {
    expect(formatDistance(0.05, "knots", "feet")).toBe(
      `${Math.round(0.05 * 6076.12)} ft`,
    );
    expect(formatDistance(0.05, "knots", "fathoms")).toBe(
      `${Math.round(0.05 * 6076.12)} ft`,
    );
    expect(formatDistance(0.05, "mph", "feet")).toBe("304 ft");
  });

  it("measures the cutoff in the speed unit's family", () => {
    // 0.09 NM is 0.104 mi and 0.167 km: above the cutoff in both.
    expect(formatDistance(0.09, "knots", "feet")).toBe("547 ft");
    expect(formatDistance(0.09, "mph", "feet")).toBe("0.10 mi");
    expect(formatDistance(0.09, "kph", "meters")).toBe("0.17 km");
  });

  it("rounds short distances to whole units", () => {
    expect(formatDistance(0.001, "knots", "meters")).toBe("2 m");
    expect(formatDistance(0.001, "knots", "feet")).toBe("6 ft");
  });
});

describe("formatNavDistance", () => {
  it("uses hundredths below 10, tenths to 100, whole units beyond", () => {
    expect(formatNavDistance(2.345, "knots")).toBe("2.35");
    expect(formatNavDistance(9.999, "knots")).toBe("10.00");
    expect(formatNavDistance(10, "knots")).toBe("10.0");
    expect(formatNavDistance(99.95, "knots")).toBe("100.0");
    expect(formatNavDistance(123.45, "knots")).toBe("123");
  });

  it("converts to the speed unit's family before choosing precision", () => {
    expect(formatNavDistance(9, "mph")).toBe("10.4");
    expect(formatNavDistance(60, "kph")).toBe("111");
  });
});

describe("formatDistanceShort", () => {
  it("formats across magnitudes with the unit", () => {
    expect(formatDistanceShort(0.3, "knots")).toBe("0.30 NM");
    expect(formatDistanceShort(12.44, "knots")).toBe("12.4 NM");
    expect(formatDistanceShort(127.4, "knots")).toBe("127 NM");
    expect(formatDistanceShort(-1, "knots")).toBe("0.00 NM");
    expect(formatDistanceShort(1, "mph")).toBe("1.15 mi");
    expect(formatDistanceShort(10, "kph")).toBe("18.5 km");
  });
});

describe("formatDistanceInSpeedUnits", () => {
  it("formats nautical miles for knots", () => {
    expect(formatDistanceInSpeedUnits(3.26, "knots")).toBe("3.3 NM");
    expect(formatDistanceInSpeedUnits(12.4, "knots")).toBe("12 NM");
  });

  it("formats kilometers for kph", () => {
    expect(formatDistanceInSpeedUnits(1, "kph")).toBe("1.9 km");
    expect(formatDistanceInSpeedUnits(10, "kph")).toBe("19 km");
  });

  it("formats statute miles for mph", () => {
    expect(formatDistanceInSpeedUnits(1, "mph")).toBe("1.2 mi");
    expect(formatDistanceInSpeedUnits(10, "mph")).toBe("12 mi");
  });

  it("switches from one decimal to whole numbers at 5 units", () => {
    expect(formatDistanceInSpeedUnits(4.99, "knots")).toBe("5.0 NM");
    expect(formatDistanceInSpeedUnits(5, "knots")).toBe("5 NM");
    expect(formatDistanceInSpeedUnits(4.5, "mph")).toBe("5 mi");
  });
});
