import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Route } from "../data/Route";
import {
  ActiveNavigationManager,
  computeNavigation,
  pickStartLeg,
  resolveRestoredLeg,
  shouldAdvanceLeg,
} from "./ActiveNavigation";
import type { NavigationData } from "./NavigationData";

// restore() loads routes/waypoints from IndexedDB — serve them from memory.
const dbMock = vi.hoisted(() => ({ routes: [] as unknown[] }));
vi.mock("../data/db", () => ({
  getAllRoutes: vi.fn(async () => dbMock.routes),
  getAllWaypoints: vi.fn(async () => []),
}));

describe("computeNavigation", () => {
  it("computes bearing and distance between two points", () => {
    // Boston Harbor to Provincetown (roughly NE)
    const result = computeNavigation(42.36, -71.06, 42.05, -70.19);
    expect(result.distanceNM).toBeGreaterThan(30);
    expect(result.distanceNM).toBeLessThan(50);
    expect(result.bearingDeg).toBeGreaterThan(100);
    expect(result.bearingDeg).toBeLessThan(150);
  });

  it("returns zero distance for same point", () => {
    const result = computeNavigation(42.36, -71.06, 42.36, -71.06);
    expect(result.distanceNM).toBeCloseTo(0, 5);
  });

  it("computes due north bearing", () => {
    const result = computeNavigation(42.0, -71.0, 43.0, -71.0);
    expect(result.bearingDeg).toBeCloseTo(0, 0);
  });

  it("computes due east bearing", () => {
    const result = computeNavigation(42.0, -71.0, 42.0, -70.0);
    expect(result.bearingDeg).toBeGreaterThan(85);
    expect(result.bearingDeg).toBeLessThan(95);
  });
});

describe("shouldAdvanceLeg", () => {
  // Leg: A(0,0) → B(0,1) — due east along equator, ~60 NM
  const fromLat = 0,
    fromLon = 0;
  const toLat = 0,
    toLon = 1;
  const arrivalRadius = 0.1; // 0.1 NM

  it("returns true when inside arrival radius", () => {
    // Vessel very close to target
    expect(
      shouldAdvanceLeg(
        0,
        0.9999,
        fromLat,
        fromLon,
        toLat,
        toLon,
        arrivalRadius,
      ),
    ).toBe(true);
  });

  it("returns true when past perpendicular (sailed past waypoint off-track)", () => {
    // Vessel at 0.05°N, 1.1°E — past B, offset north (missed radius)
    expect(
      shouldAdvanceLeg(
        0.05,
        1.1,
        fromLat,
        fromLon,
        toLat,
        toLon,
        arrivalRadius,
      ),
    ).toBe(true);
  });

  it("returns false when before perpendicular and outside radius", () => {
    // Vessel at 0°, 0.5° — halfway along, not near target
    expect(
      shouldAdvanceLeg(0, 0.5, fromLat, fromLon, toLat, toLon, arrivalRadius),
    ).toBe(false);
  });

  it("returns false when off-track but before the target perpendicular", () => {
    // Vessel at 0.5°N, 0.5°E — way off track but only halfway along
    expect(
      shouldAdvanceLeg(0.5, 0.5, fromLat, fromLon, toLat, toLon, arrivalRadius),
    ).toBe(false);
  });

  it("returns true when on-track and just past the waypoint", () => {
    // Vessel at 0°, 1.01° — just past B on the line
    expect(
      shouldAdvanceLeg(0, 1.01, fromLat, fromLon, toLat, toLon, arrivalRadius),
    ).toBe(true);
  });
});

describe("pickStartLeg", () => {
  // Route along the equator: wp0 at (0, 0), wp1 at (0, 1) — due east.
  const route: Route = {
    id: "r1",
    name: "Test",
    createdAt: 0,
    color: "#000",
    visible: true,
    waypoints: [
      { lat: 0, lon: 0, name: "WP0" },
      { lat: 0, lon: 1, name: "WP1" },
    ],
  };
  const arrivalRadius = 0.1; // NM

  it("targets waypoint[0] when the vessel is still short of it", () => {
    // Vessel west of wp0 (behind the route start) — wp0 is ahead.
    expect(pickStartLeg(0, -0.5, route, arrivalRadius)).toBe(0);
  });

  it("starts at leg 1 once the vessel has passed waypoint[0]", () => {
    // Vessel between wp0 and wp1 — already past wp0's perpendicular.
    expect(pickStartLeg(0, 0.5, route, arrivalRadius)).toBe(1);
  });

  it("starts at leg 1 when the vessel is within waypoint[0]'s arrival radius", () => {
    // Vessel essentially at wp0 (but a touch west, so not past perpendicular).
    expect(pickStartLeg(0, -0.0001, route, arrivalRadius)).toBe(1);
  });

  it("defaults to leg 1 for a degenerate single-waypoint route", () => {
    const single: Route = { ...route, waypoints: [route.waypoints[0]] };
    expect(pickStartLeg(0, -0.5, single, arrivalRadius)).toBe(1);
  });
});

// Out-and-back route along the equator: W0 (0,0) → W1 (0,1) → W2 (0.1,0).
// The return leg doubles back toward the origin, diverging 3–6 NM north of
// the outbound leg over most of its length.
const outAndBackRoute: Route = {
  id: "r-back",
  name: "Out and back",
  color: "#00f",
  visible: true,
  createdAt: 0,
  waypoints: [
    { name: "Start", lat: 0, lon: 0 },
    { name: "Out", lat: 0, lon: 1 },
    { name: "Back", lat: 0.1, lon: 0 },
  ],
} as unknown as Route;

describe("resolveRestoredLeg", () => {
  const arrivalRadius = 0.1; // NM

  it("keeps the persisted leg when the vessel is within its corridor", () => {
    // Mid-return-leg: on leg 2's track, ~3 NM off the outbound leg.
    expect(
      resolveRestoredLeg(0.05, 0.5, outAndBackRoute, 2, arrivalRadius),
    ).toBe(2);
  });

  it("keeps a persisted mid-outbound leg", () => {
    expect(resolveRestoredLeg(0, 0.5, outAndBackRoute, 1, arrivalRadius)).toBe(
      1,
    );
  });

  it("scans forward to a later leg the vessel has progressed onto", () => {
    // Persisted leg 1, but the vessel sits on the return leg's corridor.
    expect(
      resolveRestoredLeg(0.05, 0.5, outAndBackRoute, 1, arrivalRadius),
    ).toBe(2);
  });

  it("falls back to pickStartLeg when far from every remaining leg", () => {
    // Well west of the whole route: behind the start → approach leg 0.
    expect(resolveRestoredLeg(0, -3, outAndBackRoute, 2, arrivalRadius)).toBe(
      0,
    );
  });

  it("falls back for out-of-range or leg-0 persisted indices", () => {
    expect(resolveRestoredLeg(0, 0.5, outAndBackRoute, 99, arrivalRadius)).toBe(
      1,
    );
    expect(resolveRestoredLeg(0, -0.5, outAndBackRoute, 0, arrivalRadius)).toBe(
      0,
    );
  });
});

describe("restore", () => {
  const KEY = "pelorus-nav-active-nav";
  let storage: Map<string, string>;
  let onGPS: ((d: NavigationData) => void) | null;

  beforeEach(() => {
    storage = new Map();
    onGPS = null;
    dbMock.routes = [outAndBackRoute];
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeNav(fix: { lat: number; lon: number } | null) {
    const navManager = {
      subscribe: (cb: (d: NavigationData) => void) => {
        onGPS = cb;
      },
      getLastData: () =>
        fix
          ? ({ latitude: fix.lat, longitude: fix.lon } as NavigationData)
          : null,
    } as unknown as ConstructorParameters<typeof ActiveNavigationManager>[0];
    return new ActiveNavigationManager(navManager);
  }

  function persistLeg(legIndex: number): void {
    storage.set(
      KEY,
      JSON.stringify({ type: "route", routeId: "r-back", legIndex }),
    );
  }

  function legOf(nav: ActiveNavigationManager): number | null {
    const state = nav.getState();
    return state.type === "route" ? state.legIndex : null;
  }

  it("keeps a plausible persisted leg on a doubling-back route", async () => {
    persistLeg(2);
    const nav = makeNav({ lat: 0.05, lon: 0.5 }); // mid-return-leg
    await nav.restore();
    expect(legOf(nav)).toBe(2); // pickStartLeg would have re-targeted leg 1
  });

  it("falls back when the restored fix is far from the remaining route", async () => {
    persistLeg(2);
    const nav = makeNav({ lat: 0, lon: -3 }); // behind the start
    await nav.restore();
    expect(legOf(nav)).toBe(0);
  });

  it("keeps the persisted leg without a fix, then a plausible first fix confirms it", async () => {
    persistLeg(2);
    const nav = makeNav(null);
    await nav.restore();
    expect(legOf(nav)).toBe(2);

    onGPS?.({ latitude: 0.05, longitude: 0.5 } as NavigationData);
    expect(legOf(nav)).toBe(2);
  });

  it("re-resolves a fixless restore when the first fix lands far from the leg", async () => {
    persistLeg(2);
    const nav = makeNav(null);
    await nav.restore();
    expect(legOf(nav)).toBe(2);

    // Simulator-style reset: first fix appears back near the route start.
    onGPS?.({ latitude: 0, longitude: 0.01 } as NavigationData);
    expect(legOf(nav)).toBe(1);
  });

  it("falls back when the persisted legIndex is out of range", async () => {
    persistLeg(99);
    const nav = makeNav({ lat: 0.05, lon: 0.5 });
    await nav.restore();
    expect(legOf(nav)).toBe(1);
  });
});

describe("stop-on-delete", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeNav() {
    const navManager = {
      subscribe: () => {},
      getLastData: () => null,
    } as unknown as ConstructorParameters<typeof ActiveNavigationManager>[0];
    return new ActiveNavigationManager(navManager);
  }

  const route: Route = {
    id: "r1",
    name: "Test route",
    color: "#ff0000",
    visible: true,
    waypoints: [
      { id: "w1", name: "A", lat: 42.0, lon: -71.0 },
      { id: "w2", name: "B", lat: 42.1, lon: -71.0 },
    ],
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Route;

  it("noteRouteDeleted stops navigation on the deleted route and notifies", () => {
    const nav = makeNav();
    nav.startRoute(route, 1);
    expect(nav.getState().type).toBe("route");
    let notified = 0;
    nav.subscribe(() => notified++);

    nav.noteRouteDeleted("r1");
    expect(nav.getState().type).toBe("idle");
    expect(notified).toBe(1);
  });

  it("noteRouteDeleted ignores other routes and non-route navigation", () => {
    const nav = makeNav();
    nav.startRoute(route, 1);
    nav.noteRouteDeleted("other-route");
    expect(nav.getState().type).toBe("route");

    nav.stop();
    nav.startGoto({ id: "w9", name: "WP", lat: 42.0, lon: -71.0 });
    nav.noteRouteDeleted("r1");
    expect(nav.getState().type).toBe("goto");
  });

  it("noteRouteEdited re-targets navigation onto the saved geometry", () => {
    const nav = makeNav();
    nav.startRoute(route, 1);

    const edited = {
      ...route,
      waypoints: [
        { id: "w1", name: "A", lat: 42.0, lon: -71.0 },
        { id: "w3", name: "Inserted", lat: 42.05, lon: -71.02 },
        { id: "w2", name: "B", lat: 42.1, lon: -71.0 },
      ],
    } as unknown as Route;
    nav.noteRouteEdited(edited);
    const state = nav.getState();
    expect(state.type).toBe("route");
    if (state.type === "route") {
      expect(state.route.waypoints).toHaveLength(3);
      // No GPS in this fake → pickStartLeg falls back to leg 1
      expect(state.legIndex).toBe(1);
    }
  });

  it("noteRouteEdited ignores other routes and stops on a gutted route", () => {
    const nav = makeNav();
    nav.startRoute(route, 1);
    nav.noteRouteEdited({ ...route, id: "other" } as unknown as Route);
    expect(nav.getState().type).toBe("route");

    nav.noteRouteEdited({
      ...route,
      waypoints: [route.waypoints[0]],
    } as unknown as Route);
    expect(nav.getState().type).toBe("idle");
  });

  it("noteWaypointDeleted stops a goto to the deleted waypoint only", () => {
    const nav = makeNav();
    nav.startGoto({ id: "w9", name: "WP", lat: 42.0, lon: -71.0 });
    nav.noteWaypointDeleted("other");
    expect(nav.getState().type).toBe("goto");
    nav.noteWaypointDeleted("w9");
    expect(nav.getState().type).toBe("idle");
  });
});

describe("destDistanceNM", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Three waypoints stacked north along a meridian: each 0.1° leg ≈ 6 NM.
  const route: Route = {
    id: "r2",
    name: "Meridian route",
    color: "#ff0000",
    visible: true,
    waypoints: [
      { id: "w1", name: "A", lat: 42.0, lon: -71.0 },
      { id: "w2", name: "B", lat: 42.1, lon: -71.0 },
      { id: "w3", name: "C", lat: 42.3, lon: -71.0 },
    ],
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Route;

  function makeNavWithFix(lat: number, lon: number) {
    const navManager = {
      subscribe: () => {},
      getLastData: () => ({
        latitude: lat,
        longitude: lon,
        sog: 5,
        cog: 0,
        heading: null,
      }),
    } as unknown as ConstructorParameters<typeof ActiveNavigationManager>[0];
    return new ActiveNavigationManager(navManager);
  }

  it("sums vessel→target with the remaining legs", () => {
    // Vessel halfway up leg A→B: 3 NM to B, plus B→C ≈ 12 NM.
    const nav = makeNavWithFix(42.05, -71.0);
    nav.startRoute(route, 1);
    const info = nav.getInfo();
    expect(info?.destDistanceNM).toBeCloseTo(
      (info?.distanceNM ?? 0) +
        computeNavigation(42.1, -71.0, 42.3, -71.0).distanceNM,
      6,
    );
    expect(info?.destDistanceNM).toBeGreaterThan(14.5);
    expect(info?.destDistanceNM).toBeLessThan(15.5);
  });

  it("equals distanceNM on the final leg", () => {
    const nav = makeNavWithFix(42.25, -71.0);
    nav.startRoute(route, 2);
    const info = nav.getInfo();
    expect(info?.destDistanceNM).toBeCloseTo(info?.distanceNM ?? -1, 6);
  });

  it("is null in goto mode", () => {
    const nav = makeNavWithFix(42.05, -71.0);
    nav.startGoto({ id: "w9", name: "WP", lat: 42.0, lon: -71.0 });
    expect(nav.getInfo()?.destDistanceNM).toBeNull();
  });
});
