// @vitest-environment jsdom

import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThermalMonitor } from "../utils/thermal";
import { installRepaintThrottle } from "./repaintThrottle";

function makeMap(): {
  map: MapLibreMap;
  canvas: HTMLElement;
  paints: () => number;
} {
  const canvas = document.createElement("canvas");
  let paints = 0;
  const map = {
    getCanvas: () => canvas,
    isMoving: () => false,
    isZooming: () => false,
    isRotating: () => false,
    areTilesLoaded: () => true,
    triggerRepaint: () => {
      paints++;
    },
  } as unknown as MapLibreMap;
  return { map, canvas, paints: () => paints };
}

const coolThermal = { getState: () => "nominal" } as unknown as ThermalMonitor;

describe("repaintThrottle input bypass", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("repaints immediately on touch while idle-throttled (stationary)", () => {
    const { map, canvas, paints } = makeMap();
    installRepaintThrottle(map, coolThermal, () => true);

    // Prime the throttle: one repaint lands, the next is inside the 1 s
    // stationary window and would normally be deferred. (Advance past the
    // initial interval — fake performance.now() starts at 0, which makes
    // lastFrameTime=0 look like a just-painted frame.)
    vi.advanceTimersByTime(2000);
    map.triggerRepaint();
    expect(paints()).toBe(1);
    vi.advanceTimersByTime(200);
    map.triggerRepaint();
    expect(paints()).toBe(1); // still throttled — deferred

    // The bug: a new pan's first frame request arrives right after a
    // touchstart, while isMoving() is still false. It must NOT wait out
    // the stationary interval.
    canvas.dispatchEvent(new Event("touchstart"));
    map.triggerRepaint();
    expect(paints()).toBe(2);
  });

  it("returns to throttling after the input grace expires", () => {
    const { map, canvas, paints } = makeMap();
    installRepaintThrottle(map, coolThermal, () => true);

    canvas.dispatchEvent(new Event("touchstart"));
    map.triggerRepaint();
    expect(paints()).toBe(1);

    vi.advanceTimersByTime(500); // beyond INPUT_GRACE_MS
    map.triggerRepaint();
    // Inside the stationary interval again with no fresh input → deferred.
    expect(paints()).toBe(1);
  });

  it("touchmove keeps the cap lifted during a slow press-then-drag", () => {
    const { map, canvas, paints } = makeMap();
    installRepaintThrottle(map, coolThermal, () => true);

    canvas.dispatchEvent(new Event("touchstart"));
    map.triggerRepaint();
    expect(paints()).toBe(1);
    // Finger rests 400 ms (grace expired), then starts dragging.
    vi.advanceTimersByTime(400);
    canvas.dispatchEvent(new Event("touchmove"));
    map.triggerRepaint();
    expect(paints()).toBe(2);
  });
});

describe("repaintThrottle overlay-drag bypass", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Dragging a route waypoint: DraggablePoints disables dragPan, so the
   *  camera never moves and only the opening pointerdown lifted the cap.
   *  Past the grace the drag used to fall back to the idle frame rate. */
  it("keeps the cap lifted while a pointer drags with a button held", () => {
    const { map, canvas, paints } = makeMap();
    installRepaintThrottle(map, coolThermal, () => true);

    canvas.dispatchEvent(new Event("pointerdown"));
    map.triggerRepaint();
    expect(paints()).toBe(1);

    // Well past INPUT_GRACE_MS, mid-drag.
    vi.advanceTimersByTime(500);
    canvas.dispatchEvent(
      new MouseEvent("pointermove", { buttons: 1 }) as unknown as Event,
    );
    map.triggerRepaint();
    expect(paints()).toBe(2);
  });

  it("does not lift the cap for a hovering pointer", () => {
    const { map, canvas, paints } = makeMap();
    installRepaintThrottle(map, coolThermal, () => true);

    vi.advanceTimersByTime(2000);
    map.triggerRepaint();
    expect(paints()).toBe(1);

    vi.advanceTimersByTime(200);
    canvas.dispatchEvent(
      new MouseEvent("pointermove", { buttons: 0 }) as unknown as Event,
    );
    map.triggerRepaint();
    expect(paints()).toBe(1); // still throttled — hovering is not a gesture
  });
});
