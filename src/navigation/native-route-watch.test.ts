import { describe, expect, it } from "vitest";
import type { Route } from "../data/Route";
import { sandboxRouteFor } from "./native-route-watch";

const route: Route = {
  id: "r",
  name: "R",
  createdAt: 0,
  color: "#000",
  visible: true,
  waypoints: [
    { lat: 1, lon: 2, name: "A", sourceExtensions: "<x/>" },
    { lat: 3, lon: 4, name: "B" },
  ],
};

describe("sandboxRouteFor", () => {
  it("sends the route's waypoints and leg", () => {
    expect(
      sandboxRouteFor({ type: "route", route, legIndex: 1 }, true, 0.05),
    ).toEqual({
      waypoints: [
        { lat: 1, lon: 2, name: "A" },
        { lat: 3, lon: 4, name: "B" },
      ],
      legIndex: 1,
      arrivalRadiusNM: 0.05,
    });
  });

  it("sends nothing with the chime off or no route", () => {
    expect(
      sandboxRouteFor({ type: "route", route, legIndex: 1 }, false, 0.05),
    ).toBeNull();
    expect(sandboxRouteFor({ type: "idle" }, true, 0.05)).toBeNull();
  });
});
