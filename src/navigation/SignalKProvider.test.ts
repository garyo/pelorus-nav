import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import * as WS from "ws";
import type { NavigationData } from "./NavigationData";
import { SignalKProvider } from "./SignalKProvider";

// ws's CJS interop exposes the server class as `Server` under node but as the
// named `WebSocketServer` under vite/vitest; bridge both so this runs everywhere.
const WebSocketServer: typeof WS.Server =
  WS.Server ??
  (WS as unknown as { WebSocketServer: typeof WS.Server }).WebSocketServer;

// End-to-end test of the Signal K data path: the real SignalKProvider connects
// (via the node global WebSocket) to a mock Signal K server emitting the same
// delta wire-format as the ESP32 bring-up firmware
// (hardware-planning/esp32-signalk). Guards the contract the device must satisfy.

// Mirrors the synthetic circle in esp32-signalk.ino.
const CENTER_LAT = 42.338;
const CENTER_LON = -70.95;
const RADIUS_M = 300;
const OMEGA = 0.012;
const M_PER_DEG_LAT = 111320;

// The few socket members the mock server uses (ws's CJS types are awkward to
// import under verbatimModuleSyntax; a structural type is enough here).
interface MockSocket {
  readonly OPEN: number;
  readyState: number;
  send(data: string): void;
  on(event: "close", cb: () => void): void;
}

function deltaJson(theta: number): string {
  const north = RADIUS_M * Math.cos(theta);
  const east = RADIUS_M * Math.sin(theta);
  const lat = CENTER_LAT + north / M_PER_DEG_LAT;
  const lon =
    CENTER_LON +
    east / (M_PER_DEG_LAT * Math.cos((CENTER_LAT * Math.PI) / 180));
  let cog = Math.atan2(Math.cos(theta), -Math.sin(theta));
  if (cog < 0) cog += 2 * Math.PI;
  return JSON.stringify({
    context: "vessels.self",
    updates: [
      {
        source: { label: "mock-sk" },
        values: [
          {
            path: "navigation.position",
            value: { latitude: lat, longitude: lon },
          },
          { path: "navigation.courseOverGroundTrue", value: cog },
          { path: "navigation.speedOverGround", value: RADIUS_M * OMEGA },
          { path: "navigation.headingTrue", value: cog },
        ],
      },
    ],
  });
}

describe("SignalKProvider (integration)", () => {
  let wss: WS.Server | undefined;
  let provider: SignalKProvider | undefined;

  afterEach(async () => {
    provider?.disconnect();
    if (wss) await new Promise<void>((r) => wss?.close(() => r()));
    wss = undefined;
    provider = undefined;
  });

  /** Start a mock Signal K server streaming the synthetic circle. */
  async function startServer(onTick?: (n: number) => void): Promise<string> {
    wss = new WebSocketServer({ port: 0, path: "/signalk/v1/stream" });
    await new Promise<void>((r) => wss?.on("listening", () => r()));
    wss.on("connection", (sock: MockSocket) => {
      // Real Signal K sends a hello first; the provider must ignore it.
      sock.send(JSON.stringify({ name: "mock-sk", version: "1.0.0" }));
      let n = 0;
      const timer = setInterval(() => {
        n += 1;
        onTick?.(n);
        if (sock.readyState === sock.OPEN) sock.send(deltaJson(n * 0.15));
      }, 20);
      sock.on("close", () => clearInterval(timer));
    });
    const { port } = wss.address() as AddressInfo;
    return `ws://localhost:${port}/signalk/v1/stream?subscribe=none`;
  }

  /** Resolve with the first NavigationData the provider emits. */
  function firstFix(p: SignalKProvider): Promise<NavigationData> {
    return new Promise((resolve) => {
      const cb = (d: NavigationData) => {
        p.unsubscribe(cb);
        resolve(d);
      };
      p.subscribe(cb);
    });
  }

  it("parses ESP32-format deltas into NavigationData", async () => {
    const url = await startServer();
    provider = new SignalKProvider(url);
    provider.connect();

    const fix = await firstFix(provider);

    // Position lands in Boston Harbor, on the synthetic circle around centre.
    expect(fix.latitude).toBeGreaterThan(CENTER_LAT - 0.01);
    expect(fix.latitude).toBeLessThan(CENTER_LAT + 0.01);
    expect(fix.longitude).toBeGreaterThan(CENTER_LON - 0.01);
    expect(fix.longitude).toBeLessThan(CENTER_LON + 0.01);
    // Unit conversions: COG radians→degrees, SOG m/s→knots.
    expect(fix.cog).toBeGreaterThanOrEqual(0);
    expect(fix.cog).toBeLessThanOrEqual(360);
    const expectedKnots = (RADIUS_M * OMEGA) / 0.514444;
    expect(fix.sog).toBeCloseTo(expectedKnots, 1);
    expect(fix.source).toBe("signalk");
    expect(provider.isConnected()).toBe(true);
  });

  it("streams a moving position (position changes over successive fixes)", async () => {
    const url = await startServer();
    provider = new SignalKProvider(url);
    provider.connect();

    const samples: NavigationData[] = [];
    await new Promise<void>((resolve) => {
      const cb = (d: NavigationData) => {
        samples.push(d);
        if (samples.length >= 5) {
          provider?.unsubscribe(cb);
          resolve();
        }
      };
      provider?.subscribe(cb);
    });

    const moved = samples.some(
      (s) =>
        s.latitude !== samples[0].latitude ||
        s.longitude !== samples[0].longitude,
    );
    expect(moved).toBe(true);
  });

  it("does not emit before a position arrives (heading-only update)", async () => {
    // A server that only ever sends heading — provider must withhold output
    // until it has a position (hasPosition gate).
    wss = new WebSocketServer({ port: 0, path: "/signalk/v1/stream" });
    await new Promise<void>((r) => wss?.on("listening", () => r()));
    wss.on("connection", (sock: MockSocket) => {
      sock.send(
        JSON.stringify({
          updates: [
            { values: [{ path: "navigation.headingTrue", value: 1.2 }] },
          ],
        }),
      );
    });
    const { port } = wss.address() as AddressInfo;
    provider = new SignalKProvider(
      `ws://localhost:${port}/signalk/v1/stream?subscribe=none`,
    );

    let emitted = false;
    provider.subscribe(() => {
      emitted = true;
    });
    provider.connect();
    await new Promise((r) => setTimeout(r, 150));
    expect(emitted).toBe(false);
  });
});
