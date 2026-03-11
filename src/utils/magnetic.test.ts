import { describe, expect, it } from "vitest";
import {
  applyDeclination,
  bearingModeLabel,
  formatBearing,
  formatDeclination,
  getDeclination,
} from "./magnetic";

describe("magnetic utilities", () => {
  describe("getDeclination", () => {
    it("returns a plausible declination for Boston", () => {
      const decl = getDeclination(42.36, -71.06);
      // Boston declination is roughly -14° (west)
      expect(decl).toBeGreaterThan(-20);
      expect(decl).toBeLessThan(-10);
    });

    it("returns cached value for nearby position", () => {
      const d1 = getDeclination(42.36, -71.06);
      const d2 = getDeclination(42.365, -71.065);
      expect(d2).toBe(d1); // same cached value
    });

    it("recomputes for distant position", () => {
      const d1 = getDeclination(42.36, -71.06);
      const d2 = getDeclination(18.34, -64.93); // USVI
      expect(d2).not.toBe(d1);
    });
  });

  describe("applyDeclination", () => {
    it("returns true bearing unchanged in true mode", () => {
      expect(applyDeclination(45, "true", 42.36, -71.06)).toBeCloseTo(45, 5);
    });

    it("adjusts bearing in magnetic mode", () => {
      const result = applyDeclination(45, "magnetic", 42.36, -71.06);
      // With ~-14° declination, magnetic = true - (-14) = true + 14 ≈ 59
      expect(result).toBeGreaterThan(50);
      expect(result).toBeLessThan(70);
    });

    it("normalizes result to [0, 360)", () => {
      // True bearing 5° with west declination (~-14°) → magnetic ≈ 19°
      const result = applyDeclination(5, "magnetic", 42.36, -71.06);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(360);
    });

    it("handles wrap-around near 360°", () => {
      const result = applyDeclination(355, "true", 42.36, -71.06);
      expect(result).toBeCloseTo(355, 5);
    });
  });

  describe("bearingModeLabel", () => {
    it('returns "T" for true mode', () => {
      expect(bearingModeLabel("true")).toBe("T");
    });

    it('returns "M" for magnetic mode', () => {
      expect(bearingModeLabel("magnetic")).toBe("M");
    });
  });

  describe("formatBearing", () => {
    it("formats with T suffix in true mode", () => {
      const result = formatBearing(45, "true", 42.36, -71.06);
      expect(result).toBe("045°T");
    });

    it("formats with M suffix and adjusted value in magnetic mode", () => {
      const result = formatBearing(45, "magnetic", 42.36, -71.06);
      expect(result).toMatch(/^\d{3}°M$/);
      // Should be ~059°M for Boston
      const degrees = Number.parseInt(result.slice(0, 3), 10);
      expect(degrees).toBeGreaterThan(50);
      expect(degrees).toBeLessThan(70);
    });

    it("pads to 3 digits", () => {
      const result = formatBearing(5, "true", 42.36, -71.06);
      expect(result).toBe("005°T");
    });
  });

  describe("formatDeclination", () => {
    it("formats Boston declination as west", () => {
      const result = formatDeclination(42.36, -71.06);
      expect(result).toMatch(/^VAR \d+\.\d°W$/);
    });
  });
});
