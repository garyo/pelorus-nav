import { describe, expect, it, vi } from "vitest";
import type { Route } from "../data/Route";
import { PickRegistry } from "../plugins/picking";
import type { RouteLayer } from "./RouteLayer";
import {
  type RouteWaypointPickActions,
  registerRouteWaypointPick,
} from "./route-waypoint-pick";
import type { WaypointLayer } from "./WaypointLayer";

const route: Route = {
  id: "r1",
  name: "Harbor run",
  createdAt: 0,
  color: "#f00",
  visible: true,
  waypoints: [
    { name: "A", lat: 42.0, lon: -70.0 },
    { name: "B", lat: 42.1, lon: -70.1 },
    { name: "C", lat: 42.2, lon: -70.2 },
  ],
};

function collectCard(waypointIndex: number | undefined) {
  const picks = new PickRegistry();
  const routeLayer = {
    hitTest: () => [{ route, waypointIndex }],
  } as unknown as RouteLayer;
  const waypointLayer = { hitTest: () => [] } as unknown as WaypointLayer;
  const actions: RouteWaypointPickActions = {
    onRouteShown: vi.fn(),
    openRoute: vi.fn(),
    navigateRoute: vi.fn(),
    navigateRouteFrom: vi.fn(),
    isNavigating: () => false,
    openWaypoint: vi.fn(),
  };
  registerRouteWaypointPick(picks, routeLayer, waypointLayer, actions);
  const [card] = picks.collectAll({ x: 0, y: 0 });
  return { card, actions };
}

describe("route card actions", () => {
  it("a tap on the route line offers navigate + open only", () => {
    const { card } = collectCard(undefined);
    expect(card.actions?.map((a) => a.label)).toEqual([
      "Navigate route",
      "Open in Routes panel",
    ]);
  });

  it("a tap on a route waypoint also offers steering for that waypoint", () => {
    const { card, actions } = collectCard(1);
    const steer = card.actions?.find(
      (a) => a.label === "Steer for this waypoint",
    );
    expect(steer).toBeDefined();
    steer?.run();
    expect(actions.navigateRouteFrom).toHaveBeenCalledWith(route, 1);
    expect(actions.navigateRoute).not.toHaveBeenCalled();
  });

  it("the first waypoint is a valid target (leg 0 = sail to it)", () => {
    const { card, actions } = collectCard(0);
    card.actions?.find((a) => a.label === "Steer for this waypoint")?.run();
    expect(actions.navigateRouteFrom).toHaveBeenCalledWith(route, 0);
  });
});
