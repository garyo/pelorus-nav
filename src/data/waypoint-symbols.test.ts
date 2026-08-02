import { describe, expect, it } from "vitest";
import {
  DEFAULT_WAYPOINT_COLOR,
  formatWaypointSym,
  GEOMETRIC_ICONS,
  isGeometricIcon,
  parseWaypointSym,
  WAYPOINT_COLOR_NAMES,
  waypointColorHex,
} from "./waypoint-symbols";

describe("parseWaypointSym", () => {
  it("reads Garmin's shape-and-colour spelling", () => {
    expect(parseWaypointSym("Triangle, Red")).toEqual({
      icon: "triangle",
      color: "red",
    });
    expect(parseWaypointSym("Flag, Yellow")).toEqual({
      icon: "flag",
      color: "yellow",
    });
  });

  it("reads a bare shape, in any producer's casing", () => {
    // OpenCPN writes lowercase names with no colour at all.
    expect(parseWaypointSym("diamond")).toEqual({ icon: "diamond" });
    expect(parseWaypointSym("SQUARE")).toEqual({ icon: "square" });
  });

  it("maps other apps' semantic names onto ours", () => {
    expect(parseWaypointSym("Anchor").icon).toBe("anchorage");
    expect(parseWaypointSym("Caution").icon).toBe("hazard");
    expect(parseWaypointSym("Gas Station").icon).toBe("fuel");
    expect(parseWaypointSym("Residence").icon).toBe("house");
  });

  it("keeps the shape when the colour is one we don't have", () => {
    expect(parseWaypointSym("Triangle, Chartreuse")).toEqual({
      icon: "triangle",
    });
  });

  it("never colours a semantic icon — those own their colour", () => {
    expect(parseWaypointSym("Anchor, Red")).toEqual({ icon: "anchorage" });
  });

  it("falls back to a plain waypoint rather than dropping the mark", () => {
    expect(parseWaypointSym("Fish Symbol 12")).toEqual({ icon: "default" });
    expect(parseWaypointSym(null)).toEqual({ icon: "default" });
    expect(parseWaypointSym("")).toEqual({ icon: "default" });
  });

  it("handles the plain Garmin default", () => {
    expect(parseWaypointSym("Waypoint")).toEqual({ icon: "default" });
  });
});

describe("formatWaypointSym", () => {
  it("writes a name other chartplotters know", () => {
    expect(formatWaypointSym("anchorage")).toBe("Anchor");
    expect(formatWaypointSym("hazard")).toBe("Caution");
    expect(formatWaypointSym("house")).toBe("Residence");
  });

  it("fuses the colour in, the way Garmin does", () => {
    expect(formatWaypointSym("triangle", "red")).toBe("Triangle, Red");
  });

  it("omits a colour a semantic icon was somehow given", () => {
    expect(formatWaypointSym("anchorage", "red")).toBe("Anchor");
  });

  it("round-trips every shape and colour", () => {
    for (const icon of GEOMETRIC_ICONS) {
      for (const color of WAYPOINT_COLOR_NAMES) {
        expect(parseWaypointSym(formatWaypointSym(icon, color))).toEqual({
          icon,
          color,
        });
      }
    }
  });
});

describe("colours", () => {
  it("gives an uncoloured shape the default", () => {
    expect(waypointColorHex(undefined)).toBe(
      waypointColorHex(DEFAULT_WAYPOINT_COLOR),
    );
  });

  it("separates the two kinds of icon", () => {
    expect(isGeometricIcon("triangle")).toBe(true);
    expect(isGeometricIcon("anchorage")).toBe(false);
    expect(isGeometricIcon("default")).toBe(false);
  });
});
