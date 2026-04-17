import { describe, expect, it } from "vitest";
import { lightenHex } from "./color";

describe("lightenHex", () => {
  it("returns white when amount is 1", () => {
    expect(lightenHex("#336699", 1)).toBe("#ffffff");
  });

  it("returns input unchanged when amount is 0", () => {
    expect(lightenHex("#336699", 0)).toBe("#336699");
  });

  it("lightens midway toward white", () => {
    expect(lightenHex("#000000", 0.5)).toBe("#808080");
  });

  it("expands 3-digit hex", () => {
    expect(lightenHex("#f80", 0).toLowerCase()).toBe("#ff8800");
  });

  it("leaves unparseable input unchanged", () => {
    expect(lightenHex("not-a-color", 0.5)).toBe("not-a-color");
  });

  it("clamps amount above 1", () => {
    expect(lightenHex("#336699", 2)).toBe("#ffffff");
  });
});
