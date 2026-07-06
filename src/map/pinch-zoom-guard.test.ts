import type maplibregl from "maplibre-gl";
import { describe, expect, it } from "vitest";
import {
  CLAMPED_EASE_DURATION_MS,
  clampInertialZoomTarget,
  installPinchZoomGuard,
  isTouchGestureEndEvent,
  MAX_GESTURE_EASE_ZOOM_DELTA,
  WATCHDOG_ZOOM_DELTA,
} from "./pinch-zoom-guard";

describe("isTouchGestureEndEvent", () => {
  it("accepts touchend and touchcancel events", () => {
    expect(isTouchGestureEndEvent(new Event("touchend"))).toBe(true);
    expect(isTouchGestureEndEvent(new Event("touchcancel"))).toBe(true);
  });

  it("rejects other events and non-events", () => {
    expect(isTouchGestureEndEvent(new Event("touchmove"))).toBe(false);
    expect(isTouchGestureEndEvent(new Event("mouseup"))).toBe(false);
    expect(isTouchGestureEndEvent(undefined)).toBe(false);
    expect(isTouchGestureEndEvent(null)).toBe(false);
    expect(isTouchGestureEndEvent({ type: "touchend" })).toBe(false);
  });
});

describe("clampInertialZoomTarget", () => {
  it("passes targets within the budget through unchanged", () => {
    expect(clampInertialZoomTarget(12, 11.5)).toBe(11.5);
    expect(clampInertialZoomTarget(12, 12.7)).toBe(12.7);
    // Tap-zoom gestures request exactly ±1 level — must survive intact.
    expect(clampInertialZoomTarget(12, 11)).toBe(11);
    expect(clampInertialZoomTarget(12, 13)).toBe(13);
  });

  it("clamps runaway targets in both directions", () => {
    expect(clampInertialZoomTarget(12, -160)).toBe(
      12 - MAX_GESTURE_EASE_ZOOM_DELTA,
    );
    expect(clampInertialZoomTarget(12, 300)).toBe(
      12 + MAX_GESTURE_EASE_ZOOM_DELTA,
    );
  });
});

/** Minimal map stand-in covering everything the guard touches. */
function makeMapStub(initialZoom: number) {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const easeCalls: { options: Record<string, unknown>; eventData?: unknown }[] =
    [];
  let zoom = initialZoom;
  let stopCount = 0;
  const stub = {
    easeTo(options: Record<string, unknown>, eventData?: unknown) {
      easeCalls.push({ options, eventData });
      return stub;
    },
    getZoom: () => zoom,
    stop() {
      stopCount++;
      return stub;
    },
    on(type: string, fn: (e: unknown) => void) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
      return stub;
    },
  };
  return {
    map: stub as unknown as maplibregl.Map,
    easeCalls,
    setZoom: (z: number) => {
      zoom = z;
    },
    fire: (type: string, e: unknown) => {
      for (const fn of listeners.get(type) ?? []) fn(e);
    },
    getStopCount: () => stopCount,
  };
}

describe("installPinchZoomGuard", () => {
  it("clamps a runaway gesture-release ease's zoom and duration", () => {
    const t = makeMapStub(12);
    installPinchZoomGuard(t.map);
    t.map.easeTo(
      { zoom: -30, duration: 200_000 },
      { originalEvent: new Event("touchend") },
    );
    expect(t.easeCalls[0].options.zoom).toBe(12 - MAX_GESTURE_EASE_ZOOM_DELTA);
    expect(t.easeCalls[0].options.duration).toBe(CLAMPED_EASE_DURATION_MS);
  });

  it("leaves in-budget gesture eases untouched (tap-zoom)", () => {
    const t = makeMapStub(12);
    installPinchZoomGuard(t.map);
    t.map.easeTo(
      { zoom: 11, duration: 300 },
      { originalEvent: new Event("touchend") },
    );
    expect(t.easeCalls[0].options).toEqual({ zoom: 11, duration: 300 });
  });

  it("never touches programmatic eases (no originalEvent)", () => {
    const t = makeMapStub(12);
    installPinchZoomGuard(t.map);
    t.map.easeTo({ zoom: 2, duration: 5000 });
    t.map.easeTo(
      { zoom: 0, duration: 5000 },
      { originalEvent: new Event("mouseup") },
    );
    expect(t.easeCalls[0].options).toEqual({ zoom: 2, duration: 5000 });
    expect(t.easeCalls[1].options).toEqual({ zoom: 0, duration: 5000 });
  });

  it("watchdog stops a glide that exceeds its budget", () => {
    const t = makeMapStub(12);
    installPinchZoomGuard(t.map);
    const glide = { originalEvent: new Event("touchend") };
    t.fire("zoom", glide); // latches start zoom = 12
    t.setZoom(11);
    t.fire("zoom", glide);
    expect(t.getStopCount()).toBe(0); // within budget
    t.setZoom(12 - WATCHDOG_ZOOM_DELTA - 0.1);
    t.fire("zoom", glide);
    expect(t.getStopCount()).toBe(1);
  });

  it("watchdog ignores gesture-driven and programmatic zooms", () => {
    const t = makeMapStub(12);
    installPinchZoomGuard(t.map);
    // Active pinch: originalEvent is a touchmove.
    t.setZoom(4);
    t.fire("zoom", { originalEvent: new Event("touchmove") });
    // Programmatic flyTo: no originalEvent.
    t.setZoom(0);
    t.fire("zoom", {});
    expect(t.getStopCount()).toBe(0);
  });

  it("a new gesture ease resets the watchdog budget", () => {
    const t = makeMapStub(12);
    installPinchZoomGuard(t.map);
    const glide = { originalEvent: new Event("touchend") };
    t.fire("zoom", glide); // budget from zoom 12
    t.setZoom(11.2);
    t.fire("zoom", glide);
    // Second tap-out ease starts: budget re-latches at the current zoom.
    t.map.easeTo(
      { zoom: 10.2, duration: 300 },
      { originalEvent: new Event("touchend") },
    );
    t.setZoom(10.2);
    t.fire("zoom", glide); // 1.0 from the new budget — no trip
    expect(t.getStopCount()).toBe(0);
  });
});
