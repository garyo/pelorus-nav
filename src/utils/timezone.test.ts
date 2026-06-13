import { describe, expect, it } from "vitest";
import { shortTimeZone } from "./timezone";

describe("shortTimeZone", () => {
  it("gives the daylight abbreviation in summer", () => {
    expect(
      shortTimeZone(new Date("2025-06-21T12:00:00Z"), "America/New_York"),
    ).toBe("EDT");
  });

  it("gives the standard abbreviation in winter", () => {
    expect(
      shortTimeZone(new Date("2025-01-21T12:00:00Z"), "America/New_York"),
    ).toBe("EST");
  });

  it("returns UTC for the UTC zone", () => {
    expect(shortTimeZone(new Date("2025-06-21T12:00:00Z"), "UTC")).toBe("UTC");
  });

  it("returns a non-empty token for the device zone", () => {
    expect(shortTimeZone().length).toBeGreaterThan(0);
  });
});
