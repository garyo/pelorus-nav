import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as WS from "ws";
import type { NavigationData } from "./NavigationData";
import type { ProviderNotice } from "./ProviderNotice";
import { SignalKProvider } from "./SignalKProvider";

// ws's CJS interop exposes the server class as `Server` under node but as the
// named `WebSocketServer` under vite/vitest; bridge both so this runs everywhere.
const WebSocketServer: typeof WS.Server =
  WS.Server ??
  (WS as unknown as { WebSocketServer: typeof WS.Server }).WebSocketServer;

// End-to-end test of the Signal K data path: the real SignalKProvider connects
// (via the node global WebSocket) to a mock Signal K server emitting the same
// delta wire-format as the ESP32 bring-up firmware (esp32-signalk, kept in the
// separate pelorus-nav-hw repo). Guards the contract the device must satisfy.

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

// Reconnect lifecycle: server restarts, URL moves, rate hints, notices —
// the resilience layer added on ReconnectingTransport. Real sockets, real
// timers (the reconnect backoff starts at 1s, so these tests wait for it).
describe("SignalKProvider reconnect lifecycle", () => {
  let servers: WS.Server[] = [];
  let provider: SignalKProvider | undefined;

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    provider?.disconnect();
    provider = undefined;
    for (const wss of servers) {
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
    }
    servers = [];
  });

  const wsUrl = (port: number) =>
    `ws://localhost:${port}/signalk/v1/stream?subscribe=none`;

  const listening = (wss: WS.Server) =>
    new Promise<void>((r) => wss.on("listening", () => r()));

  const portOf = (wss: WS.Server) => (wss.address() as AddressInfo).port;

  /** Start a delta-streaming mock server (port 0 = ephemeral). */
  async function streamServer(port = 0): Promise<WS.Server> {
    const wss = new WebSocketServer({ port, path: "/signalk/v1/stream" });
    servers.push(wss);
    await listening(wss);
    wss.on("connection", (sock: MockSocket) => {
      const timer = setInterval(() => {
        if (sock.readyState === sock.OPEN) sock.send(deltaJson(0.3));
      }, 20);
      sock.on("close", () => clearInterval(timer));
    });
    return wss;
  }

  async function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > deadline) throw new Error("waitFor timed out");
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  it("auto-reconnects after the server restarts", async () => {
    const wss1 = await streamServer();
    const port = portOf(wss1);
    provider = new SignalKProvider(wsUrl(port));
    provider.connect();
    await waitFor(() => provider?.isConnected() ?? false);

    // Kill the server: the drop is noticed and retried on a backoff.
    for (const c of wss1.clients) c.terminate();
    await new Promise<void>((r) => wss1.close(() => r()));
    servers.splice(servers.indexOf(wss1), 1);
    await waitFor(() => provider?.isReconnecting() ?? false);

    // The server comes back on the same port — a backoff retry finds it.
    const wss2 = await streamServer(port);
    await waitFor(() => provider?.isConnected() ?? false, 8000);
    expect(wss2.clients.size).toBe(1);
  }, 15000);

  it("watchdog silence reconnect does not leak the old socket", async () => {
    // A server that accepts the connection but never sends deltas: the TCP
    // link stays alive (no close event) while the watchdog's silence limit
    // elapses, forcing a reconnect. The old, still-open socket must be
    // closed by the client before opening the replacement.
    const wss = new WebSocketServer({ port: 0, path: "/signalk/v1/stream" });
    servers.push(wss);
    await listening(wss);
    let connections = 0;
    wss.on("connection", () => {
      connections++; // silent — no periodic sends, so the link goes quiet
    });
    const port = portOf(wss);
    provider = new SignalKProvider(wsUrl(port));
    provider.connect();
    await waitFor(() => provider?.isConnected() ?? false);
    expect(connections).toBe(1);

    // Default silence limit is silenceLimitFor(1000) = 10s; the watchdog
    // trips on its next 4s tick after that (~12s) and reconnects almost
    // immediately against a local server.
    await waitFor(() => connections >= 2, 20000);
    await waitFor(() => provider?.isConnected() ?? false, 5000);

    // Only one live server-side connection should remain — the replacement.
    // A leak shows up as two: the orphaned original plus the new one.
    expect(wss.clients.size).toBe(1);
  }, 30000);

  it("setUrl moves a live connection to the new server (close race)", async () => {
    const wssA = await streamServer();
    const wssB = await streamServer();
    provider = new SignalKProvider(wsUrl(portOf(wssA)));
    provider.connect();
    await waitFor(() => wssA.clients.size === 1);

    provider.setUrl(wsUrl(portOf(wssB)));
    await waitFor(() => wssB.clients.size === 1);
    // The old socket's close event must not clobber the new link.
    await waitFor(() => wssA.clients.size === 0);
    await new Promise((r) => setTimeout(r, 200));
    expect(provider.isConnected()).toBe(true);
    expect(wssB.clients.size).toBe(1);
  }, 10000);

  it("setDesiredIntervalMs re-subscribes with a clamped whole-second period", async () => {
    interface SkMessage {
      subscribe?: Array<{ path: string; period: number }>;
      unsubscribe?: Array<{ path: string }>;
    }
    const messages: SkMessage[] = [];
    const wss = new WebSocketServer({ port: 0, path: "/signalk/v1/stream" });
    servers.push(wss);
    await listening(wss);
    wss.on("connection", (sock) => {
      (sock as unknown as { on(e: string, cb: (d: unknown) => void): void }).on(
        "message",
        (d) => messages.push(JSON.parse(String(d)) as SkMessage),
      );
    });
    provider = new SignalKProvider(wsUrl(portOf(wss)));
    provider.connect();
    await waitFor(() => messages.length >= 1);
    expect(messages[0].subscribe?.[0].period).toBe(1000); // default

    provider.setDesiredIntervalMs(2600); // → 3s (whole seconds)
    await waitFor(() => messages.length >= 3);
    expect(messages[1].unsubscribe).toBeDefined();
    expect(messages[2].subscribe?.every((s) => s.period === 3000)).toBe(true);

    provider.setDesiredIntervalMs(60000); // clamped to the 10s ceiling
    await waitFor(() => messages.length >= 5);
    expect(messages[4].subscribe?.[0].period).toBe(10000);

    provider.setDesiredIntervalMs(9800); // rounds back to 10s — no re-subscribe
    await new Promise((r) => setTimeout(r, 100));
    expect(messages.length).toBe(5);
  }, 10000);

  it("emits connect-failed when unreachable, connected on success", async () => {
    // Find a port with nothing listening on it.
    const probe = new WebSocketServer({ port: 0 });
    await listening(probe);
    const deadPort = (probe.address() as AddressInfo).port;
    await new Promise<void>((r) => probe.close(() => r()));

    const notices: ProviderNotice[] = [];
    provider = new SignalKProvider(wsUrl(deadPort), (n) => notices.push(n));
    provider.connect();
    await waitFor(() => notices.some((n) => n.kind === "connect-failed"));
    expect(provider.isConnected()).toBe(false);
    expect(provider.isReconnecting()).toBe(true); // intent survives, backoff runs
    provider.disconnect();

    const wss = await streamServer();
    provider = new SignalKProvider(wsUrl(portOf(wss)), (n) => notices.push(n));
    provider.connect();
    await waitFor(() => notices.some((n) => n.kind === "connected"));
    expect(provider.isConnected()).toBe(true);
  }, 10000);
});
