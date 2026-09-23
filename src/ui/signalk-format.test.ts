import { describe, expect, it } from "vitest";
import { formatLatLon } from "../utils/coordinates";
import { ageTone, formatAge, formatSignalkValue } from "./signalk-format";

describe("formatAge", () => {
  it("scales from tenths of a second to hours", () => {
    expect(formatAge(400)).toBe("0.4 s");
    expect(formatAge(12400)).toBe("12 s");
    expect(formatAge(185000)).toBe("3 min");
    expect(formatAge(7200000)).toBe("2 h");
  });
});

describe("ageTone", () => {
  it("is green when live, amber when stale, red when long gone", () => {
    expect(ageTone(1000)).toBe("green");
    expect(ageTone(10000)).toBe("amber");
    expect(ageTone(60000)).toBe("red");
  });
});

describe("formatSignalkValue", () => {
  it("rounds numbers to four significant digits", () => {
    expect(formatSignalkValue(3.2101341465673174)).toBe("3.21");
    expect(formatSignalkValue(18.8)).toBe("18.8");
    expect(formatSignalkValue(101325)).toBe("101300");
  });

  it("shows positions as coordinates and missing values as a dash", () => {
    expect(formatSignalkValue({ latitude: 60.08, longitude: 23.54 })).toBe(
      `${formatLatLon(60.08, "lat")} ${formatLatLon(23.54, "lon")}`,
    );
    expect(formatSignalkValue(null)).toBe("—");
    expect(formatSignalkValue(Number.NaN)).toBe("—");
  });

  it("clips long strings and objects", () => {
    const text = formatSignalkValue({
      setTrue: 0,
      setMagnetic: 0,
      drift: 0.123456789,
      extra: "x".repeat(40),
    });
    expect(text.length).toBe(48);
    expect(text.endsWith("…")).toBe(true);
    expect(formatSignalkValue("GNSS Fix")).toBe("GNSS Fix");
  });
});
