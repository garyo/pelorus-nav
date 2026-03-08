import { afterEach, describe, expect, it, vi } from "vitest";
import type { NavigationData } from "./NavigationData";
import { SimulatorProvider } from "./SimulatorProvider";

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
    expect(first.sog).toBe(6);
    // COG should be roughly north (0 degrees)
    expect(first.cog).not.toBeNull();
    expect(first.cog ?? 0).toBeCloseTo(0, 0);

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
    expect(received[0].sog).toBe(6);
    expect(received[0].cog).not.toBeNull();

    sim.disconnect();
  });
});
