import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateSettings } from "../settings";
import { installOverlayDimming, reapplyOverlayDimming } from "./overlayDimming";

// Stub localStorage for updateSettings in test environment
if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      store: {} as Record<string, string>,
      getItem(key: string) {
        return this.store[key] ?? null;
      },
      setItem(key: string, val: string) {
        this.store[key] = val;
      },
      removeItem(key: string) {
        delete this.store[key];
      },
    },
  });
}

interface MockLayer {
  id: string;
  type: "line" | "circle" | "symbol";
}

/** Minimal MapLibre map stand-in: only the members overlayDimming touches. */
function createMockMap(layers: MockLayer[]): {
  map: MapLibreMap;
  setPaintProperty: ReturnType<typeof vi.fn>;
} {
  const setPaintProperty = vi.fn();
  const map = {
    isStyleLoaded: () => true,
    getStyle: () => ({ layers }) as unknown as StyleSpecification,
    getLayer: (id: string) => layers.find((l) => l.id === id),
    setPaintProperty,
    on: vi.fn(),
    once: (_event: string, cb: () => void) => cb(),
  };
  return { map: map as unknown as MapLibreMap, setPaintProperty };
}

describe("overlayDimming", () => {
  beforeEach(() => {
    updateSettings({ displayTheme: "day" });
  });

  it("dims overlay layers present at the time the theme is applied", () => {
    const { map, setPaintProperty } = createMockMap([
      { id: "_route-line-abc", type: "line" },
    ]);
    installOverlayDimming(map);

    updateSettings({ displayTheme: "night" });

    expect(setPaintProperty).toHaveBeenCalledWith(
      "_route-line-abc",
      "line-opacity",
      expect.any(Number),
    );
  });

  it("leaves a layer recreated after the theme was applied at full brightness (memoized apply)", () => {
    const layers: MockLayer[] = [];
    const { map, setPaintProperty } = createMockMap(layers);
    installOverlayDimming(map);
    updateSettings({ displayTheme: "night" });

    // Simulate a route recreated mid-session (e.g. RouteLayer.reloadAll)
    // at hard-coded full opacity, with the theme unchanged.
    layers.push({ id: "_route-line-new", type: "line" });
    setPaintProperty.mockClear();
    updateSettings({ displayTheme: "night" });

    expect(setPaintProperty).not.toHaveBeenCalledWith(
      "_route-line-new",
      "line-opacity",
      expect.any(Number),
    );
  });

  it("reapplyOverlayDimming heals a recreated layer even when the theme is unchanged", () => {
    const layers: MockLayer[] = [];
    const { map, setPaintProperty } = createMockMap(layers);
    installOverlayDimming(map);
    updateSettings({ displayTheme: "night" });

    layers.push({ id: "_route-line-new", type: "line" });
    setPaintProperty.mockClear();

    reapplyOverlayDimming(map);

    expect(setPaintProperty).toHaveBeenCalledWith(
      "_route-line-new",
      "line-opacity",
      expect.any(Number),
    );
  });
});
