// @vitest-environment jsdom

import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraggablePoints } from "./DraggablePoints";
import type { GeoPoint } from "./point-hit-test";
import { isMapPressClaimed, releaseMapPress } from "./press-claim";

/**
 * Focused lifecycle tests. The concern is not the happy-path drag (covered by
 * E2E) but the interruption edges where a drag can end without a normal
 * touchend/mouseup and leave `dragPan` disabled — the map then can't be
 * panned for the rest of the session.
 */

type MapHandler = (e: { point: { x: number; y: number } }) => void;

/** Minimal map: identity-ish projection, a tracked dragPan, a real canvas,
 *  and captured mouse handlers so tests can drive the mouse path. */
function makeMap(): {
  map: MapLibreMap;
  canvas: HTMLCanvasElement;
  dragPanEnabled: () => boolean;
  fire: (type: string, x: number, y: number) => void;
} {
  const canvas = document.createElement("canvas");
  // getBoundingClientRect is 0×0 in jsdom by default — fine, screen coords
  // equal client coords, which is all the geometric hit test needs.
  let dragPanEnabled = true;
  // Arrays, not one handler per type: DraggablePoints registers a second
  // mousemove listener while a hold is pending, and real MapLibre fires both.
  const handlers = new Map<string, MapHandler[]>();
  const map = {
    getCanvas: () => canvas,
    getLayer: () => ({}),
    project: (ll: [number, number]) => ({ x: ll[0], y: -ll[1] }),
    unproject: ([x, y]: [number, number]) => ({ lng: x, lat: -y }),
    dragPan: {
      enable: () => {
        dragPanEnabled = true;
      },
      disable: () => {
        dragPanEnabled = false;
      },
    },
    on: (type: string, handler: MapHandler) => {
      const list = handlers.get(type);
      if (list) list.push(handler);
      else handlers.set(type, [handler]);
    },
    off: (type: string, handler: MapHandler) => {
      const list = handlers.get(type);
      if (list)
        handlers.set(
          type,
          list.filter((h) => h !== handler),
        );
    },
  } as unknown as MapLibreMap;
  // getBoundingClientRect is 0x0 in jsdom, so canvas coords are client coords.
  const fire = (type: string, x: number, y: number) => {
    for (const handler of handlers.get(type) ?? []) {
      handler({
        point: { x, y },
        originalEvent: { clientX: x, clientY: y },
        preventDefault: () => {},
      } as never);
    }
  };
  return { map, canvas, dragPanEnabled: () => dragPanEnabled, fire };
}

/** Dispatch a touch event with the given touch points (as changedTouches
 *  and touches both), since jsdom lacks the Touch/TouchEvent constructors. */
function touch(
  canvas: HTMLElement,
  type: string,
  points: { id: number; x: number; y: number }[],
): void {
  const list = points.map((p) => ({
    identifier: p.id,
    clientX: p.x,
    clientY: p.y,
  }));
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "touches", { value: list });
  Object.defineProperty(e, "changedTouches", { value: list });
  canvas.dispatchEvent(e);
}

const POINT: GeoPoint = { lat: 0, lon: 0 }; // projects to (0, 0)

function makeDraggable(map: MapLibreMap) {
  const onDrag = vi.fn();
  const onTap = vi.fn();
  const dp = new DraggablePoints(map, "layer", onDrag, onTap, null, null, {
    getPoints: () => [POINT],
    hitRadius: 20,
  });
  return { dp, onDrag, onTap };
}

describe("DraggablePoints drag lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("re-enables dragPan when a drag is interrupted by touchcancel", () => {
    const { map, canvas, dragPanEnabled } = makeMap();
    makeDraggable(map);

    touch(canvas, "touchstart", [{ id: 1, x: 0, y: 0 }]);
    expect(dragPanEnabled()).toBe(false); // grabbed → pan suspended

    touch(canvas, "touchcancel", [{ id: 1, x: 0, y: 0 }]);
    expect(dragPanEnabled()).toBe(true); // interruption must restore it
  });

  it("does not fire a tap when a drag is cancelled", () => {
    const { map, canvas } = makeMap();
    const { onTap } = makeDraggable(map);

    touch(canvas, "touchstart", [{ id: 1, x: 0, y: 0 }]);
    touch(canvas, "touchcancel", [{ id: 1, x: 0, y: 0 }]);
    expect(onTap).not.toHaveBeenCalled();
  });

  it("re-enables dragPan when destroyed mid-drag", () => {
    const { map, canvas, dragPanEnabled } = makeMap();
    const { dp } = makeDraggable(map);

    touch(canvas, "touchstart", [{ id: 1, x: 0, y: 0 }]);
    expect(dragPanEnabled()).toBe(false);

    dp.destroy();
    expect(dragPanEnabled()).toBe(true);
  });

  it("ignores a second finger's touchend during a drag", () => {
    const { map, canvas, dragPanEnabled } = makeMap();
    const { onTap } = makeDraggable(map);

    touch(canvas, "touchstart", [{ id: 1, x: 0, y: 0 }]); // finger 1 grabs
    // Finger 2 taps elsewhere and lifts — its touchend must not end the drag.
    touch(canvas, "touchend", [{ id: 2, x: 200, y: 200 }]);
    expect(dragPanEnabled()).toBe(false); // still dragging
    expect(onTap).not.toHaveBeenCalled();

    // Finger 1 lifting (no movement) ends the drag and taps.
    touch(canvas, "touchend", [{ id: 1, x: 0, y: 0 }]);
    expect(dragPanEnabled()).toBe(true);
    expect(onTap).toHaveBeenCalledWith(0);
  });

  it("ends a drag on a mouseup received outside the canvas", () => {
    const { map, canvas, dragPanEnabled } = makeMap();
    makeDraggable(map);

    // Grab via touch (mousedown path needs a MapMouseEvent), then release the
    // mouse on the window — the drag must still end.
    touch(canvas, "touchstart", [{ id: 1, x: 0, y: 0 }]);
    expect(dragPanEnabled()).toBe(false);

    window.dispatchEvent(new Event("mouseup"));
    expect(dragPanEnabled()).toBe(true);
  });

  it("absorbs a sub-slop mouse jiggle without dragging", () => {
    const { map, fire } = makeMap();
    const { onDrag } = makeDraggable(map);

    fire("mousedown", 0, 0); // grab the point at (0,0)
    fire("mousemove", 3, 3); // 4.2 px — under the 6 px tap slop
    expect(onDrag).not.toHaveBeenCalled();

    fire("mousemove", 8, 0); // now past slop
    expect(onDrag).toHaveBeenCalledTimes(1);
  });
});

/**
 * The hold gate (holdMs) for handles that live on the ordinary chart. What
 * matters is that a press which turns out to be a pan never picks anything
 * up — the failure mode is silent data loss, not a stuck gesture.
 */
describe("DraggablePoints press-and-hold gate", () => {
  const HOLD_MS = 350;

  function makeHoldDraggable(map: MapLibreMap) {
    const onDrag = vi.fn();
    const onTap = vi.fn();
    const onGrab = vi.fn();
    const dp = new DraggablePoints(map, "layer", onDrag, onTap, null, null, {
      getPoints: () => [POINT],
      hitRadius: 20,
      holdMs: HOLD_MS,
      onGrab,
    });
    return { dp, onDrag, onTap, onGrab };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    releaseMapPress();
  });

  it("does not grab until the hold has elapsed", () => {
    const { map, canvas, dragPanEnabled } = makeMap();
    const { onGrab } = makeHoldDraggable(map);

    touch(canvas, "touchstart", [{ id: 1, x: 0, y: 0 }]);
    // Still the map's gesture: a pan starting here must pan from pixel one.
    expect(dragPanEnabled()).toBe(true);
    expect(onGrab).not.toHaveBeenCalled();

    vi.advanceTimersByTime(HOLD_MS);
    expect(dragPanEnabled()).toBe(false);
    expect(onGrab).toHaveBeenCalledWith(0);
  });

  it("abandons the hold when the finger moves — the press was a pan", () => {
    const { map, canvas, dragPanEnabled } = makeMap();
    const { onGrab, onDrag } = makeHoldDraggable(map);

    touch(canvas, "touchstart", [{ id: 1, x: 0, y: 0 }]);
    touch(canvas, "touchmove", [{ id: 1, x: 30, y: 0 }]);
    vi.advanceTimersByTime(HOLD_MS * 2);

    expect(onGrab).not.toHaveBeenCalled();
    expect(onDrag).not.toHaveBeenCalled();
    expect(dragPanEnabled()).toBe(true);
  });

  it("keeps the hold through sub-slop jitter", () => {
    const { map, canvas } = makeMap();
    const { onGrab } = makeHoldDraggable(map);

    touch(canvas, "touchstart", [{ id: 1, x: 0, y: 0 }]);
    touch(canvas, "touchmove", [{ id: 1, x: 4, y: 4 }]); // 5.7 px, under slop
    vi.advanceTimersByTime(HOLD_MS);

    expect(onGrab).toHaveBeenCalledWith(0);
  });

  it("abandons the hold when a second finger lands (pinch)", () => {
    const { map, canvas } = makeMap();
    const { onGrab } = makeHoldDraggable(map);

    touch(canvas, "touchstart", [{ id: 1, x: 0, y: 0 }]);
    touch(canvas, "touchmove", [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 60, y: 60 },
    ]);
    vi.advanceTimersByTime(HOLD_MS);

    expect(onGrab).not.toHaveBeenCalled();
  });

  it("lifting before the hold arms is a plain tap, not a grab", () => {
    const { map, canvas, dragPanEnabled } = makeMap();
    const { onGrab, onTap } = makeHoldDraggable(map);

    touch(canvas, "touchstart", [{ id: 1, x: 0, y: 0 }]);
    touch(canvas, "touchend", [{ id: 1, x: 0, y: 0 }]);
    vi.advanceTimersByTime(HOLD_MS * 2);

    expect(onGrab).not.toHaveBeenCalled();
    // No drag was ever started, so the press is left to the click handlers
    // rather than consumed here.
    expect(onTap).not.toHaveBeenCalled();
    expect(dragPanEnabled()).toBe(true);
  });

  it("claims the press while grabbed and releases it on drop", () => {
    const { map, canvas } = makeMap();
    makeHoldDraggable(map);

    touch(canvas, "touchstart", [{ id: 1, x: 0, y: 0 }]);
    vi.advanceTimersByTime(HOLD_MS);
    // The chart's own long-press must stand down for this press.
    expect(isMapPressClaimed()).toBe(true);

    touch(canvas, "touchend", [{ id: 1, x: 0, y: 0 }]);
    expect(isMapPressClaimed()).toBe(false);
  });

  it("does not arm a hold left pending when destroyed", () => {
    const { map, canvas, dragPanEnabled } = makeMap();
    const { dp, onGrab } = makeHoldDraggable(map);

    touch(canvas, "touchstart", [{ id: 1, x: 0, y: 0 }]);
    dp.destroy();
    vi.advanceTimersByTime(HOLD_MS * 2);

    expect(onGrab).not.toHaveBeenCalled();
    expect(dragPanEnabled()).toBe(true);
  });

  it("holds on the mouse path too, then drags from the press point", () => {
    const { map, fire, dragPanEnabled } = makeMap();
    const { onGrab, onDrag } = makeHoldDraggable(map);

    fire("mousedown", 0, 0);
    expect(dragPanEnabled()).toBe(true);

    vi.advanceTimersByTime(HOLD_MS);
    expect(onGrab).toHaveBeenCalledWith(0);

    fire("mousemove", 20, 0);
    expect(onDrag).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression: the hold used to watch the map's own mousemove, which
   * MapLibre stops firing once a drag gesture engages — so a press that began
   * panning still armed after the delay and dragged the handle away mid-pan.
   * The cancel must come from raw DOM events, which nothing suppresses.
   */
  it("abandons a mouse hold on a raw DOM mousemove the map never reports", () => {
    const { map, fire } = makeMap();
    const { onGrab, onDrag } = makeHoldDraggable(map);

    fire("mousedown", 0, 0);
    // Deliberately NOT fire("mousemove", ...) — the map is silent here.
    window.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 40, clientY: 0 }),
    );
    vi.advanceTimersByTime(HOLD_MS * 2);

    expect(onGrab).not.toHaveBeenCalled();
    expect(onDrag).not.toHaveBeenCalled();
  });

  it("keeps a mouse hold through sub-slop pointer jitter", () => {
    const { map, fire } = makeMap();
    const { onGrab } = makeHoldDraggable(map);

    fire("mousedown", 0, 0);
    window.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 4, clientY: 4 }),
    );
    vi.advanceTimersByTime(HOLD_MS);

    expect(onGrab).toHaveBeenCalledWith(0);
  });
});
