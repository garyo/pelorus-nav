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
// Drawing the waypoint icons needs a canvas; the ordering under test does not.
vi.mock("./point-icons", () => ({
  ensurePointIcons: vi.fn(),
  POINT_ICON_CHEVRON_SUBTLE: "chevron",
  pointRole: () => "mid",
  ROLE_ICON_EXPR: ["literal", "icon"],
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
  // hitTest needs the route layers to exist and a feature list to query.
  queryRenderedFeatures = vi.fn(() => [] as unknown[]);
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

describe("RouteLayer.hitTest ordering", () => {
  const route = (id: string, name: string) => ({
    id,
    name,
    createdAt: 0,
    color: "#4488cc",
    visible: true,
    waypoints: [
      { lat: 42.36, lon: -71.05, name: "Shared Mark" },
      { lat: 42.35, lon: -71.03, name: "End" },
    ],
  });

  /** A layer holding both routes, with a tap that hits each one's mark. */
  async function twoRoutesUnderTheTap() {
    const alpha = route("rt-alpha", "Alpha Route");
    const bravo = route("rt-bravo", "Bravo Route");
    mocks.getAllRoutes.mockResolvedValue([alpha, bravo]);
    const map = new FakeMap();
    map.getLayer = vi.fn(() => ({}) as never);
    // Render order: Bravo's layers were added last, so it queries topmost.
    map.queryRenderedFeatures = vi.fn(() => [
      { source: "_route-rt-bravo", properties: { index: 0 } },
      { source: "_route-rt-alpha", properties: { index: 0 } },
    ]) as never;
    const layer = new RouteLayer(map as unknown as maplibregl.Map);
    await layer.reloadAll();
    return { layer, alpha, bravo };
  }

  const box = [
    [0, 0],
    [1, 1],
  ] as [maplibregl.PointLike, maplibregl.PointLike];

  beforeEach(() => {
    mocks.getAllRoutes.mockReset();
    mocks.getAllRoutes.mockResolvedValue([]);
  });

  it("returns topmost first when nothing is selected", async () => {
    const { layer } = await twoRoutesUnderTheTap();
    expect(layer.hitTest(box).map((h) => h.route.id)).toEqual([
      "rt-bravo",
      "rt-alpha",
    ]);
  });

  it("leads with the selected route, whichever draws on top", async () => {
    const { layer, alpha } = await twoRoutesUnderTheTap();
    layer.selectRoute(alpha);
    expect(layer.hitTest(box).map((h) => h.route.id)).toEqual([
      "rt-alpha",
      "rt-bravo",
    ]);
  });

  it("keeps the rest in render order when the selection already leads", async () => {
    const { layer, bravo } = await twoRoutesUnderTheTap();
    layer.selectRoute(bravo);
    expect(layer.hitTest(box).map((h) => h.route.id)).toEqual([
      "rt-bravo",
      "rt-alpha",
    ]);
  });

  it("still carries the tapped waypoint index for each route", async () => {
    const { layer, alpha } = await twoRoutesUnderTheTap();
    layer.selectRoute(alpha);
    expect(layer.hitTest(box).map((h) => h.waypointIndex)).toEqual([0, 0]);
  });

  it("is unaffected when the selected route is not under the tap", async () => {
    const { layer } = await twoRoutesUnderTheTap();
    layer.selectRoute(route("rt-charlie", "Charlie Route"));
    expect(layer.hitTest(box).map((h) => h.route.id)).toEqual([
      "rt-bravo",
      "rt-alpha",
    ]);
  });
});
