import type maplibregl from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getVectorSourceIds } from "../data/chart-catalog";
import { SafetyContour } from "./SafetyContour";

type Handler = (...args: unknown[]) => void;

function createFakeMap(sourceFeatures: Record<string, unknown[]> = {}) {
  const handlers: Record<string, Handler[]> = {};
  let center = { lng: -71, lat: 42.35 };
  return {
    on: vi.fn((event: string, handler: Handler) => {
      handlers[event] ??= [];
      handlers[event].push(handler);
    }),
    getCenter: vi.fn(() => center),
    setCenter(next: { lng: number; lat: number }) {
      center = next;
    },
    getZoom: vi.fn(() => 12),
    getBearing: vi.fn(() => 0),
    getContainer: vi.fn(() => ({ clientWidth: 1000, clientHeight: 800 })),
    querySourceFeatures: vi.fn(
      (sourceId: string) => sourceFeatures[sourceId] ?? [],
    ),
    getLayer: vi.fn(() => ({}) as unknown),
    setFilter: vi.fn(),
    setPaintProperty: vi.fn(),
    _fire(event: string) {
      for (const fn of handlers[event] ?? []) fn();
    },
  };
}

describe("SafetyContour", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe("Finding 1: debouncedScan under continuous moveend", () => {
    it("keeps scanning periodically under a steady 10 Hz moveend stream instead of starving", () => {
      const map = createFakeMap();
      new SafetyContour(map as unknown as maplibregl.Map);
      const sourceIdCount = getVectorSourceIds().length;

      // Simulate follow-mode `jumpTo` firing moveend ~10 Hz while the boat
      // moves steadily, so the viewport gate is open on every tick.
      let lng = -71;
      for (let i = 0; i < 50; i++) {
        lng += 0.1;
        map.setCenter({ lng, lat: 42.35 });
        map._fire("moveend");
        vi.advanceTimersByTime(100);
      }

      const scans = map.querySourceFeatures.mock.calls.length / sourceIdCount;
      // A non-re-arming trailing throttle bounds staleness at ~1s, so a 5s
      // continuous stream must produce several scans, not zero.
      expect(scans).toBeGreaterThanOrEqual(3);
      // ...and bounds the rate too: never faster than once per window.
      expect(scans).toBeLessThanOrEqual(6);
    });
  });

  describe("Chart-8: styledata churn", () => {
    it("does not reapply filters on every styledata event, only on style.load", () => {
      const sourceIds = getVectorSourceIds();
      const map = createFakeMap({
        [sourceIds[0]]: [{ properties: { _cell_id: 1, VALDCO: 9999 } }],
      });
      new SafetyContour(map as unknown as maplibregl.Map);

      // Initial map load resolves a safety contour so reapplyAll has
      // something to apply.
      map._fire("load");
      map.setFilter.mockClear();
      map.setPaintProperty.mockClear();

      // Other overlays (vessel, route, highlights) mutating the style all
      // fire "styledata" — this must not trigger a reapply.
      for (let i = 0; i < 20; i++) map._fire("styledata");
      expect(map.setFilter).not.toHaveBeenCalled();
      expect(map.setPaintProperty).not.toHaveBeenCalled();

      // A real style rebuild (ChartManager resets layers to placeholder)
      // fires "style.load" and must reapply.
      map._fire("style.load");
      expect(map.setFilter).toHaveBeenCalled();
    });
  });
});
