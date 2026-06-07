import { afterEach, describe, expect, it, vi } from "vitest";
import type { NavigationData } from "./NavigationData";
import { replayPosition, SimulatorProvider } from "./SimulatorProvider";

describe("SimulatorProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("has correct id and name", () => {
    const sim = new SimulatorProvider();
    expect(sim.id).toBe("simulator");
    expect(sim.name).toBe("Simulator");
  });

  it("isConnected returns false before connect", () => {
    const sim = new SimulatorProvider();
    expect(sim.isConnected()).toBe(false);
  });

  it("isConnected returns true after connect, false after disconnect", () => {
    vi.useFakeTimers();
    const sim = new SimulatorProvider();
    sim.connect();
    expect(sim.isConnected()).toBe(true);
    sim.disconnect();
    expect(sim.isConnected()).toBe(false);
  });

  it("fires callback on connect and on interval", () => {
    vi.useFakeTimers();
    const sim = new SimulatorProvider({ intervalMs: 100 });
    const received: NavigationData[] = [];
    sim.subscribe((data) => received.push({ ...data }));

    sim.connect();
    // Should fire immediately on connect
    expect(received.length).toBe(1);
    expect(received[0].source).toBe("simulator");

    // Advance timer
    vi.advanceTimersByTime(100);
    expect(received.length).toBe(2);

    vi.advanceTimersByTime(100);
    expect(received.length).toBe(3);

    sim.disconnect();
  });

  it("static mode returns fixed position", () => {
    vi.useFakeTimers();
    const sim = new SimulatorProvider({
      mode: "static",
      position: [42.0, -71.0],
    });
    const received: NavigationData[] = [];
    sim.subscribe((data) => received.push({ ...data }));

    sim.connect();
    expect(received[0].latitude).toBe(42.0);
    expect(received[0].longitude).toBe(-71.0);
    expect(received[0].sog).toBe(0);
    expect(received[0].cog).toBeNull();
    sim.disconnect();
  });

  it("route mode computes position and COG", () => {
    vi.useFakeTimers();
    const waypoints: [number, number][] = [
      [42.0, -71.0],
      [42.1, -71.0], // due north
    ];
    const sim = new SimulatorProvider({
      mode: "route",
      waypoints,
      speed: 6,
      intervalMs: 1000,
    });

    const received: NavigationData[] = [];
    sim.subscribe((data) => received.push({ ...data }));

    sim.connect();
    const first = received[0];
    expect(first.latitude).toBeCloseTo(42.0, 2);
    expect(first.longitude).toBeCloseTo(-71.0, 2);
    expect(first.sog).toBeCloseTo(6, 0);
    // COG should be roughly north (0°), within jitter tolerance (wraps around 360)
    expect(first.cog).not.toBeNull();
    const cogDelta = Math.abs((((first.cog ?? 0) + 180) % 360) - 180);
    expect(cogDelta).toBeLessThan(10);

    sim.disconnect();
  });

  it("unsubscribe stops callbacks", () => {
    vi.useFakeTimers();
    const sim = new SimulatorProvider({ intervalMs: 100 });
    let count = 0;
    const cb = () => {
      count++;
    };

    sim.subscribe(cb);
    sim.connect();
    expect(count).toBe(1);

    sim.unsubscribe(cb);
    vi.advanceTimersByTime(100);
    expect(count).toBe(1); // no additional calls

    sim.disconnect();
  });

  it("circular mode produces valid positions", () => {
    vi.useFakeTimers();
    const sim = new SimulatorProvider({
      mode: "circular",
      center: [42.35, -71.04],
      radius: 0.5,
      speed: 6,
    });
    const received: NavigationData[] = [];
    sim.subscribe((data) => received.push({ ...data }));

    sim.connect();
    expect(received[0].latitude).toBeCloseTo(42.35, 1);
    expect(received[0].sog).toBeCloseTo(6, 0);
    expect(received[0].cog).not.toBeNull();

    sim.disconnect();
  });
});

// Simple L-shaped track: 60 s north, then 60 s east, ~111 m legs
const TRACK: [number, number, number][] = [
  [0, 42.0, -71.0],
  [60, 42.001, -71.0],
  [120, 42.001, -70.99865],
];

describe("replayPosition", () => {
  it("interpolates position within a segment", () => {
    const p = replayPosition(TRACK, 30);
    expect(p.lat).toBeCloseTo(42.0005, 6);
    expect(p.lon).toBeCloseTo(-71.0, 6);
  });

  it("derives COG from the active segment", () => {
    expect(replayPosition(TRACK, 30).cog).toBeCloseTo(0, 0); // northbound
    expect(replayPosition(TRACK, 90).cog).toBeCloseTo(90, 0); // eastbound
  });

  it("derives SOG from segment distance over time", () => {
    // 0.001° lat ≈ 111 m in 60 s ≈ 3.6 kt
    expect(replayPosition(TRACK, 30).sogKn).toBeGreaterThan(3.4);
    expect(replayPosition(TRACK, 30).sogKn).toBeLessThan(3.8);
  });

  it("loops past the end of the track", () => {
    const p = replayPosition(TRACK, 120 + 30); // wraps to t=30
    expect(p.lat).toBeCloseTo(42.0005, 6);
  });

  it("handles exact endpoint times", () => {
    expect(replayPosition(TRACK, 60).lat).toBeCloseTo(42.001, 6);
    expect(replayPosition(TRACK, 0).lat).toBeCloseTo(42.0, 6);
  });
});

describe("replayPosition SOG continuity", () => {
  // Two segments with different speeds: 111 m/60 s then ~222 m/60 s
  const VARYING: [number, number, number][] = [
    [0, 42.0, -71.0],
    [60, 42.001, -71.0],
    [120, 42.003, -71.0],
  ];

  it("is continuous across segment boundaries", () => {
    const before = replayPosition(VARYING, 59.5).sogKn;
    const after = replayPosition(VARYING, 60.5).sogKn;
    // Raw segment speeds differ ~2x (3.6 vs 7.2 kt); the blended value
    // must not step across the boundary
    expect(Math.abs(after - before)).toBeLessThan(0.25);
  });

  it("still reflects the overall speed change mid-segment", () => {
    expect(replayPosition(VARYING, 20).sogKn).toBeLessThan(
      replayPosition(VARYING, 100).sogKn,
    );
  });
});
