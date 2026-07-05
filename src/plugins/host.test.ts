import type maplibregl from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartManager } from "../chart/ChartManager";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import { activatePlugin, type HostDeps } from "./host";
import type { LegendHost } from "./legend";
import type { PickRegistry } from "./picking";
import type { Plugin, PluginHost } from "./types";

type Handler = (...args: unknown[]) => void;

function createFakeMap() {
  const handlers: Record<string, Handler[]> = {};
  let center = { lng: -71, lat: 42.35 };
  return {
    on: vi.fn((event: string, handler: Handler) => {
      handlers[event] ??= [];
      handlers[event].push(handler);
    }),
    off: vi.fn((event: string, handler: Handler) => {
      handlers[event] = (handlers[event] ?? []).filter((h) => h !== handler);
    }),
    getCenter: vi.fn(() => center),
    setCenter(next: { lng: number; lat: number }) {
      center = next;
    },
    getZoom: vi.fn(() => 12),
    getBearing: vi.fn(() => 0),
    getContainer: vi.fn(() => ({ clientWidth: 1000, clientHeight: 800 })),
    getLayer: vi.fn(() => undefined),
    isStyleLoaded: vi.fn(() => true),
    _fire(event: string) {
      for (const fn of handlers[event] ?? []) fn();
    },
  };
}

function activateTestPlugin(map: ReturnType<typeof createFakeMap>) {
  let capturedHost: PluginHost | undefined;
  const plugin: Plugin = {
    manifest: {
      id: "test.plugin",
      name: "Test",
      version: "1.0.0",
      apiVersion: "1.0.0",
      capabilities: [],
    },
    activate(host) {
      capturedHost = host;
    },
  };
  const deps: HostDeps = {
    map: map as unknown as maplibregl.Map,
    chartManager: {} as unknown as ChartManager,
    navManager: {} as unknown as NavigationDataManager,
    picks: { register: vi.fn(() => () => {}) } as unknown as PickRegistry,
    legends: {
      set: vi.fn(),
      setStatus: vi.fn(),
    } as unknown as LegendHost,
    topbar: { register: vi.fn() },
    suppressPick: vi.fn(),
  };
  activatePlugin(plugin, deps);
  if (!capturedHost) throw new Error("plugin did not activate");
  return capturedHost;
}

describe("PluginHost events.onMapMove", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps refreshing periodically under a steady 10 Hz moveend stream instead of starving (8a-7)", () => {
    const map = createFakeMap();
    const host = activateTestPlugin(map);
    const fn = vi.fn();
    host.events.onMapMove(fn, 150);

    // Simulate follow-mode moveend firing ~10 Hz while the boat moves
    // steadily, so the viewport gate is open on every tick.
    let lng = -71;
    for (let i = 0; i < 50; i++) {
      lng += 0.1;
      map.setCenter({ lng, lat: 42.35 });
      map._fire("moveend");
      vi.advanceTimersByTime(100);
    }

    // A non-re-arming trailing throttle bounds staleness at ~150ms, so a 5s
    // continuous stream must produce many refreshes, not zero.
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(10);
  });

  it("skips refresh when the viewport hasn't moved materially", () => {
    const map = createFakeMap();
    const host = activateTestPlugin(map);
    const fn = vi.fn();
    host.events.onMapMove(fn, 150);

    map._fire("moveend"); // first call: prev is null → always material
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);

    map._fire("moveend"); // no actual movement
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
