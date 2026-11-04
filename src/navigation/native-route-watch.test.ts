import { describe, expect, it } from "vitest";
import type { Route } from "../data/Route";
import {
  nativeLegAhead,
  routeWatchSource,
  sandboxRouteFor,
} from "./native-route-watch";

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

describe("routeWatchSource", () => {
  it("follows the sources the service can read itself", () => {
    expect(routeWatchSource("capacitor-gps")).toBe("device");
    expect(routeWatchSource("bt-spp")).toBe("serial");
    expect(routeWatchSource("signalk")).toBeNull();
    expect(routeWatchSource("ble-nmea")).toBeNull();
    expect(routeWatchSource("simulator")).toBeNull();
  });
});

describe("nativeLegAhead", () => {
  const state = { type: "route" as const, route, legIndex: 0 };
  const native = (legIndex: number, name = "B") => ({
    waypoints: [
      { lat: 1, lon: 2, name: "A" },
      { lat: 3, lon: 4, name },
    ],
    legIndex,
    arrivalRadiusNM: 0.1,
  });

  it("gives the leg the native side reached ahead on the same route", () => {
    expect(nativeLegAhead(state, native(1))).toBe(1);
    expect(nativeLegAhead(state, native(2))).toBe(2); // finished
  });

  it("gives nothing when the native side is not ahead", () => {
    expect(nativeLegAhead(state, native(0))).toBeNull();
    expect(nativeLegAhead({ ...state, legIndex: 1 }, native(1))).toBeNull();
  });

  it("gives nothing for another route, or none", () => {
    expect(nativeLegAhead(state, native(1, "Other"))).toBeNull();
    expect(nativeLegAhead(state, null)).toBeNull();
    expect(nativeLegAhead({ type: "idle" }, native(1))).toBeNull();
  });
});
