// @vitest-environment jsdom
import type * as maplibregl from "maplibre-gl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZoomControl } from "./ZoomControl";

const settingsListeners: Array<(s: { showZoomButtons: boolean }) => void> = [];
let showZoomButtons = true;
vi.mock("../settings", () => ({
  getSettings: () => ({ showZoomButtons }),
  onSettingsChange: (fn: (s: { showZoomButtons: boolean }) => void) => {
    settingsListeners.push(fn);
  },
}));

function createMockMap(zoom = 10, bearing = 0) {
  const handlers: Record<string, (() => void)[]> = {};
  return {
    zoom,
    bearing,
    on: vi.fn((event: string, fn: () => void) => {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(fn);
    }),
    off: vi.fn(),
    getZoom() {
      return this.zoom;
    },
    getMinZoom: () => 2,
    getMaxZoom: () => 18,
    getBearing() {
      return this.bearing;
    },
    setZoom: vi.fn(function (this: { zoom: number }, z: number) {
      this.zoom = z;
      for (const fn of handlers.zoom ?? []) fn();
    }),
    setBearing: vi.fn(function (this: { bearing: number }, b: number) {
      this.bearing = b;
      for (const fn of handlers.rotate ?? []) fn();
    }),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    easeTo: vi.fn(),
    resetNorth: vi.fn(),
  };
}

describe("ZoomControl", () => {
  let map: ReturnType<typeof createMockMap>;
  let el: HTMLElement;

  beforeEach(() => {
    settingsListeners.length = 0;
    showZoomButtons = true;
    map = createMockMap();
    el = new ZoomControl().onAdd(map as unknown as maplibregl.Map);
  });

  const button = (cls: string) =>
    el.querySelector<HTMLButtonElement>(`.${cls}`) as HTMLButtonElement;

  it("zooms by one step with no eventData, never through the eased camera methods", () => {
    button("maplibregl-ctrl-zoom-in").click();
    expect(map.setZoom).toHaveBeenCalledWith(11);
    button("maplibregl-ctrl-zoom-out").click();
    expect(map.setZoom).toHaveBeenLastCalledWith(10);
    expect(map.zoomIn).not.toHaveBeenCalled();
    expect(map.zoomOut).not.toHaveBeenCalled();
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  it("resets the bearing instantly without eventData", () => {
    map.bearing = 45;
    button("maplibregl-ctrl-compass").click();
    expect(map.setBearing).toHaveBeenCalledWith(0);
    expect(map.resetNorth).not.toHaveBeenCalled();
  });

  it("rotates the compass icon against the map bearing", () => {
    map.setBearing(30);
    const icon = button("maplibregl-ctrl-compass").querySelector("span");
    expect(icon?.style.transform).toBe("rotate(-30deg)");
  });

  it("disables the buttons at the zoom limits", () => {
    map.setZoom(18);
    expect(button("maplibregl-ctrl-zoom-in").disabled).toBe(true);
    expect(button("maplibregl-ctrl-zoom-out").disabled).toBe(false);
    map.setZoom(2);
    expect(button("maplibregl-ctrl-zoom-out").disabled).toBe(true);
    expect(button("maplibregl-ctrl-zoom-in").disabled).toBe(false);
  });

  it("hides the whole group when the setting is off", () => {
    expect(el.style.display).toBe("");
    for (const fn of settingsListeners) fn({ showZoomButtons: false });
    expect(el.style.display).toBe("none");
    for (const fn of settingsListeners) fn({ showZoomButtons: true });
    expect(el.style.display).toBe("");
  });
});
