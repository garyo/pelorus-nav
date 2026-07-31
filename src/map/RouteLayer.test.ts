import type * as maplibregl from "maplibre-gl";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAllRoutes: vi.fn(),
}));

vi.mock("../data/db", () => ({
  getAllRoutes: mocks.getAllRoutes,
  saveRoute: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../app/overlayDimming", () => ({
  reapplyOverlayDimming: vi.fn(),
}));

import { RouteLayer } from "./RouteLayer";

/** Just enough map for RouteLayer's constructor and source/layer bookkeeping. */
class FakeMap {
  on = vi.fn();
  isStyleLoaded = vi.fn(() => false);
  getSource = vi.fn(() => undefined);
  addSource = vi.fn();
  addLayer = vi.fn();
  getLayer = vi.fn(() => undefined);
  removeLayer = vi.fn();
  removeSource = vi.fn();
  setLayoutProperty = vi.fn();
  setPaintProperty = vi.fn();
  getStyle = vi.fn(() => ({ layers: [] }));
}

function makeLayer(): RouteLayer {
  return new RouteLayer(new FakeMap() as unknown as maplibregl.Map);
}

describe("RouteLayer change bus", () => {
  beforeEach(() => {
    mocks.getAllRoutes.mockReset();
    mocks.getAllRoutes.mockResolvedValue([]);
  });

  it("notifies subscribers when the route set reloads", async () => {
    const layer = makeLayer();
    const seen = vi.fn();
    layer.onChange(seen);

    await layer.reloadAll();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("notifies every subscriber", async () => {
    const layer = makeLayer();
    const first = vi.fn();
    const second = vi.fn();
    layer.onChange(first);
    layer.onChange(second);

    await layer.reloadAll();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
