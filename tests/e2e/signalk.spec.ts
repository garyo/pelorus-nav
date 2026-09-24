import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import * as WS from "ws";
import { acceptDisclaimer, seedSettings, suppressWhatsNew } from "./helpers";

// ws's CJS interop exposes the server class as `Server` or `WebSocketServer`
// depending on the loader; bridge both.
const WebSocketServer: typeof WS.Server =
  WS.Server ??
  (WS as unknown as { WebSocketServer: typeof WS.Server }).WebSocketServer;

const SELF = "vessels.urn:mrn:signalk:uuid:e2e-self";

async function startWithSignalK(
  page: import("@playwright/test").Page,
  server: string,
): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await suppressWhatsNew(page);
  await acceptDisclaimer(page);
  await seedSettings(page, { gpsSource: "signalk", signalkServer: server });
  await page.goto("/");
  await expect(page.locator(".maplibregl-map")).toBeVisible({ timeout: 10000 });
  return errors;
}

/**
 * Starting up with Signal K already chosen: the settings panel is built
 * before the GPS providers exist, so nothing it runs at build time may reach
 * them (a failure there aborts startup and leaves only the bare chart).
 */
test("starts fully with Signal K as the saved source", async ({ page }) => {
  // Port 9 (discard) on loopback: nothing listens, so the connect is refused.
  const errors = await startWithSignalK(page, "127.0.0.1:9");
  await expect(page.locator("#topbar-actions")).toContainText("RTE");
  await expect(page.locator(".settings-signalk-status")).toHaveText(
    "✕ Can't reach the server, retrying",
    { timeout: 10000 },
  );
  expect(errors).toEqual([]);
});

test("navigates from a Signal K server's position", async ({ page }) => {
  const wss = new WebSocketServer({ port: 0, path: "/signalk/v1/stream" });
  await new Promise<void>((r) => wss.on("listening", () => r()));
  wss.on("connection", (sock) => {
    sock.send(JSON.stringify({ name: "e2e-sk", version: "1.0.0", self: SELF }));
    let n = 0;
    const timer = setInterval(() => {
      n += 1;
      sock.send(
        JSON.stringify({
          context: SELF,
          updates: [
            {
              $source: "e2e.GP",
              timestamp: new Date().toISOString(),
              values: [
                {
                  path: "navigation.position",
                  value: { latitude: 42.35 + n * 1e-5, longitude: -71.04 },
                },
              ],
            },
          ],
        }),
      );
    }, 500);
    sock.on("close", () => clearInterval(timer));
  });
  try {
    const { port } = wss.address() as AddressInfo;
    const errors = await startWithSignalK(page, `127.0.0.1:${port}`);
    await expect(page.locator(".settings-signalk-status")).toHaveText(
      "✓ Connected, receiving position",
      { timeout: 15000 },
    );
    expect(errors).toEqual([]);
  } finally {
    for (const c of wss.clients) c.terminate();
    await new Promise<void>((r) => wss.close(() => r()));
  }
});
