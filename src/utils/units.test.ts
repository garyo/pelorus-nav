import { describe, expect, it } from "vitest";
import { formatDistanceNM } from "./units";

describe("formatDistanceNM", () => {
  it("formats as NM at or above 0.1", () => {
    expect(formatDistanceNM(0.1, "meters")).toBe("0.10 NM");
    expect(formatDistanceNM(1.234, "meters")).toBe("1.23 NM");
    expect(formatDistanceNM(12.4, "feet")).toBe("12.40 NM");
  });

  it("switches to meters below 0.1 NM when depth unit is meters", () => {
    expect(formatDistanceNM(0.05, "meters")).toBe(
      `${Math.round(0.05 * 1852)} m`,
    );
  });

  it("switches to feet below 0.1 NM when depth unit is feet or fathoms", () => {
    expect(formatDistanceNM(0.05, "feet")).toBe(
      `${Math.round(0.05 * 6076.12)} ft`,
    );
    expect(formatDistanceNM(0.05, "fathoms")).toBe(
      `${Math.round(0.05 * 6076.12)} ft`,
    );
  });

  it("rounds sub-0.1NM distances to whole units", () => {
    expect(formatDistanceNM(0.001, "meters")).toBe("2 m");
    expect(formatDistanceNM(0.001, "feet")).toBe("6 ft");
  });
});
