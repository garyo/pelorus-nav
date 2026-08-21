import { expect, test } from "@playwright/test";
import {
  acceptDisclaimer,
  closeSettings,
  openSettings,
  seedRoute,
  seedSettings,
  suppressWhatsNew,
} from "./helpers";

// First three points of SimulatorProvider's BOSTON_HARBOR_ROUTE. `simStart`
// below is set to the first point, so the simulator's own path traces
// exactly A -> B -> C -> ... and this route's waypoints sit precisely on
// that path — arrival is geometric fact, not a timing guess.
const A: [number, number] = [42.363715, -71.04743]; // inner harbor
const B: [number, number] = [42.352039, -71.032698]; // off Castle Island
const C: [number, number] = [42.354634, -71.030561]; // across the channel

const ROUTE_ID = "e2e-route-follow";

/**
 * Route-follow: activate a route whose waypoints lie on the simulator's
 * actual path, then watch the InstrumentHUD's "Next: <waypoint>" caption
 * advance as the simulated vessel arrives at each one.
 *
 * GPS source is left at "none" until after the route is activated. With no
 * GPS fix yet, ActiveNavigationManager.pickStartLeg deterministically picks
 * leg 1 (target = the 2nd waypoint, "Castle Island") regardless of how long
 * the earlier setup steps (panel opens, IndexedDB seed) took in real time —
 * only switching to the simulator afterwards starts its position clock, so
 * the "arrives at Castle Island, advances to President Roads" transition we
 * assert on isn't racing unrelated UI setup time under parallel-worker load.
 */
test("simulator-driven route navigation advances through waypoints on arrival", async ({
  page,
}) => {
  await suppressWhatsNew(page);
  await acceptDisclaimer(page);
  await seedSettings(page, {
    simulatorSpeed: 100,
    showInstrumentHUD: true,
  });

  // simStart forces SimulatorProvider into "route" mode over
  // [A, ...BOSTON_HARBOR_ROUTE], starting exactly at A. gpsSource stays at
  // its default ("none" in a browser context) until we flip it below.
  await page.goto(`/?simStart=${A[0]},${A[1]}`);
  await expect(page.locator(".maplibregl-map")).toBeVisible({
    timeout: 10000,
  });

  // The Routes button only exists once boot-time restore (which touches
  // IndexedDB) has completed, so by the time we can click it the "routes"
  // object store is guaranteed to exist.
  const routesBtn = page.getByRole("button", { name: "Routes" });
  await routesBtn.click();
  await expect(page.locator(".manager-panel.route-manager-panel")).toHaveClass(
    /open/,
  );

  await seedRoute(page, {
    id: ROUTE_ID,
    name: "E2E Harbor Loop",
    createdAt: Date.now(),
    color: "#4488cc",
    visible: true,
    waypoints: [
      { lat: A[0], lon: A[1], name: "Inner Harbor" },
      { lat: B[0], lon: B[1], name: "Castle Island" },
      { lat: C[0], lon: C[1], name: "President Roads" },
    ],
  });

  // Close and reopen to force a refresh() against the now-seeded route.
  await routesBtn.click();
  await routesBtn.click();

  const routeRow = page.locator(`.manager-item[data-route-id="${ROUTE_ID}"]`);
  await expect(routeRow).toBeVisible({ timeout: 5000 });

  // Activate navigation with no GPS fix yet — deterministic leg-1 start.
  await routeRow.locator(".route-nav-btn").click();

  const nextWp = page.locator(".instrument-next-wp-name");
  await expect(nextWp).toBeVisible({ timeout: 5000 });
  await expect(nextWp).toHaveText("Next: Castle Island");

  // Now start the simulator — its position clock begins from this instant.
  await routesBtn.click(); // close Routes panel out of the way
  await openSettings(page);
  await page.locator('.settings-tab[data-tab="navigation"]').click();
  await page.locator("#settings-gps-source").selectOption("simulator");
  await closeSettings(page);

  // As the simulated vessel reaches Castle Island's arrival radius,
  // ActiveNavigationManager advances the leg and the HUD caption updates —
  // the "waypoint arrival/advance" signal this test exists to catch.
  await expect(nextWp).toHaveText("Next: President Roads", { timeout: 15000 });
});
