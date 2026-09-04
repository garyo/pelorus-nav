import type * as maplibregl from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";
import { s52Colour } from "../chart/s52-colours";
import type { ActiveNavigationManager } from "../navigation/ActiveNavigation";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import { BearingLine } from "./BearingLine";

let displayTheme = "day";
vi.mock("../settings", () => ({
  getSettings: () => ({ displayTheme }),
}));

function setupLine(): { paints: Record<string, unknown>[] } {
  const paints: Record<string, unknown>[] = [];
  const map = {
    on: vi.fn(),
    isStyleLoaded: () => true,
    getSource: () => undefined,
    addSource: vi.fn(),
    addLayer: vi.fn((layer: { paint: Record<string, unknown> }) => {
      paints.push(layer.paint);
    }),
  };
  const activeNav = { subscribe: vi.fn() };
  const navManager = { getLastData: () => null };
  new BearingLine(
    map as unknown as maplibregl.Map,
    activeNav as unknown as ActiveNavigationManager,
    navManager as unknown as NavigationDataManager,
  );
  return { paints };
}

describe("BearingLine colour", () => {
  it("draws the line and target ring in the theme's S-52 user-info orange", () => {
    displayTheme = "day";
    const { paints } = setupLine();
    expect(paints[0]["line-color"]).toBe(s52Colour("UINFO", "DAY"));
    expect(paints[1]["circle-stroke-color"]).toBe(s52Colour("UINFO", "DAY"));
    expect(paints[0]["line-dasharray"]).toEqual([4, 3]);
  });

  it("follows the night palette", () => {
    displayTheme = "night";
    const { paints } = setupLine();
    expect(paints[0]["line-color"]).toBe(s52Colour("UINFO", "NIGHT"));
    expect(paints[0]["line-color"]).not.toBe(s52Colour("UINFO", "DAY"));
  });
});
