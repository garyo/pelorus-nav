import { afterEach, describe, expect, it } from "vitest";
import { updateSettings } from "../settings";
import { s52Colour } from "./s52-colours";

describe("s52Colour white deep water", () => {
  afterEach(() => {
    updateSettings({ whiteDeepWater: false, displayTheme: "day" });
  });

  it("keeps the S-52 palette by default", () => {
    expect(s52Colour("DEPDW", "DAY")).toBe("#C9EDFE");
    expect(s52Colour("NAIDH", "DAY")).toBe("#C9EDFE");
  });

  it("turns deep water and its matching halos white in the day palette", () => {
    updateSettings({ whiteDeepWater: true });
    for (const token of ["DEPDW", "CHWHT", "SNDGH", "NAIDH"]) {
      expect(s52Colour(token, "DAY")).toBe("#FFFFFF");
      expect(s52Colour(token)).toBe("#FFFFFF");
    }
    expect(s52Colour("DEPMD", "DAY")).toBe("#A7D9FB");
  });

  it("leaves the other palettes alone", () => {
    updateSettings({ whiteDeepWater: true });
    expect(s52Colour("DEPDW", "NIGHT")).toBe("#000000");
    expect(s52Colour("DEPDW", "EINK")).toBe("#f8fafd");
    updateSettings({ displayTheme: "night" });
    expect(s52Colour("DEPDW")).toBe("#000000");
  });
});
