import type maplibregl from "maplibre-gl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NavigationData } from "../navigation/NavigationData";
import { ChartModeController, computeLookAheadPadding } from "./ChartMode";

// Mock settings module
vi.mock("../settings", () => ({
  getSettings: () => ({ chartMode: "north-up" }),
  updateSettings: vi.fn(),
}));

function createMockMap() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(handler);
    }),
    jumpTo: vi.fn(),
    getBearing: vi.fn(() => 0),
    getCanvas: vi.fn(() => ({
      addEventListener: vi.fn(),
      clientWidth: 1000,
      clientHeight: 800,
    })),
    // Container and canvas are the same size in the test (no overshoot).
    getContainer: vi.fn(() => ({ clientWidth: 1000, clientHeight: 800 })),
    _fire(event: string, payload: unknown) {
      for (const fn of handlers[event] ?? []) {
        fn(payload);
      }
    },
  };
}

function makeNavData(overrides?: Partial<NavigationData>): NavigationData {
  return {
    latitude: 42.35,
    longitude: -71.04,
    cog: 90,
    sog: 6,
    heading: 90,
    accuracy: 5,
    timestamp: Date.now(),
    source: "simulator",
    ...overrides,
  };
}

describe("ChartModeController", () => {
  let mockMap: ReturnType<typeof createMockMap>;
  let controller: ChartModeController;

  beforeEach(() => {
    mockMap = createMockMap();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock map for testing
    controller = new ChartModeController(mockMap as unknown as maplibregl.Map);
  });

  it("starts in north-up mode from settings", () => {
    expect(controller.getMode()).toBe("north-up");
  });

  it("setMode changes mode", () => {
    controller.setMode("follow");
    expect(controller.getMode()).toBe("follow");
  });

  it("update in follow mode centers map", () => {
    controller.setMode("follow");
    controller.update(makeNavData());
    expect(mockMap.jumpTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [-71.04, 42.35] }),
    );
  });

  it("update in north-up mode centers with bearing 0", () => {
    controller.setMode("north-up");
    controller.update(makeNavData());
    expect(mockMap.jumpTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [-71.04, 42.35], bearing: 0 }),
    );
  });

  it("update in course-up mode sets bearing from heading", () => {
    controller.setMode("course-up");
    controller.update(makeNavData({ heading: 45 }));
    expect(mockMap.jumpTo).toHaveBeenCalledWith(
      expect.objectContaining({ bearing: 45 }),
    );
  });

  it("update in free mode does not move map", () => {
    controller.setMode("free");
    mockMap.jumpTo.mockClear();
    controller.update(makeNavData());
    expect(mockMap.jumpTo).not.toHaveBeenCalled();
  });

  it("user pan switches to free mode", () => {
    controller.setMode("follow");
    // Simulate user-initiated movestart (has originalEvent)
    mockMap._fire("movestart", { originalEvent: { type: "mousedown" } });
    expect(controller.getMode()).toBe("free");
  });

  it("programmatic move does not switch to free mode", () => {
    controller.setMode("follow");
    // Simulate programmatic movestart (no originalEvent)
    mockMap._fire("movestart", {});
    expect(controller.getMode()).toBe("follow");
  });

  it("recenter restores previous non-free mode", () => {
    controller.setMode("course-up");
    // User pans → free
    mockMap._fire("movestart", { originalEvent: { type: "mousedown" } });
    expect(controller.getMode()).toBe("free");
    // Recenter should restore course-up, not follow
    controller.recenter();
    expect(controller.getMode()).toBe("course-up");
  });

  it("recenter restores north-up when that was active", () => {
    controller.setMode("north-up");
    mockMap._fire("movestart", { originalEvent: { type: "mousedown" } });
    expect(controller.getMode()).toBe("free");
    controller.recenter();
    expect(controller.getMode()).toBe("north-up");
  });

  it("applies look-ahead padding when moving fast in course-up", () => {
    controller.setMode("course-up");
    controller.update(makeNavData({ cog: 0, heading: 0, sog: 6 }));
    const call = mockMap.jumpTo.mock.calls.at(-1)?.[0];
    // Mocked canvas is 1000×800; offset = 0.25 × 800 = 200; padding = 2 × 200
    expect(call?.padding?.top).toBeCloseTo(2 * 0.25 * 800, 5);
    expect(call?.padding?.bottom).toBe(0);
    expect(call?.padding?.left).toBe(0);
    expect(call?.padding?.right).toBe(0);
  });

  it("uses no offset when sog is below the min threshold", () => {
    controller.setMode("course-up");
    controller.update(makeNavData({ cog: 0, heading: 0, sog: 0.5 }));
    const call = mockMap.jumpTo.mock.calls.at(-1)?.[0];
    expect(call?.padding).toEqual({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    });
  });

  it("north-up moving east shifts boat toward the left", () => {
    controller.setMode("north-up");
    controller.update(makeNavData({ cog: 90, heading: 90, sog: 6 }));
    const call = mockMap.jumpTo.mock.calls.at(-1)?.[0];
    expect(call?.padding?.right).toBeCloseTo(2 * 0.25 * 1000, 5);
    expect(call?.padding?.left).toBe(0);
    expect(call?.padding?.top).toBeCloseTo(0, 5);
    expect(call?.padding?.bottom).toBeCloseTo(0, 5);
  });

  it("north-up moving south shifts boat toward the top", () => {
    controller.setMode("north-up");
    controller.update(makeNavData({ cog: 180, heading: 180, sog: 6 }));
    const call = mockMap.jumpTo.mock.calls.at(-1)?.[0];
    expect(call?.padding?.bottom).toBeCloseTo(2 * 0.25 * 800, 5);
    expect(call?.padding?.top).toBeCloseTo(0, 5);
  });
});

describe("computeLookAheadPadding", () => {
  const canvas = { width: 1000, height: 800 };

  it("returns zero padding below min speed", () => {
    expect(computeLookAheadPadding(0, 0.5, canvas)).toEqual({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    });
  });

  it("returns zero padding when direction is null", () => {
    expect(computeLookAheadPadding(null, 6, canvas)).toEqual({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    });
  });

  it("returns zero padding when canvas has no size", () => {
    expect(computeLookAheadPadding(0, 6, { width: 0, height: 0 })).toEqual({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    });
  });

  // padding = 2 × offset, so max padding.top in 800-tall canvas = 2 × 0.25 × 800 = 400
  const maxTop = 2 * 0.25 * 800;
  const maxSide = 2 * 0.25 * 1000;

  it("ramps linearly between 1 and 3 kt", () => {
    const halfwayUp = computeLookAheadPadding(0, 2, canvas);
    expect(halfwayUp.top).toBeCloseTo(0.5 * maxTop, 5);
  });

  it("clamps at max speed", () => {
    const fast = computeLookAheadPadding(0, 100, canvas);
    expect(fast.top).toBeCloseTo(maxTop, 5);
  });

  it("θ=0 (ahead = up) → padding.top only", () => {
    const p = computeLookAheadPadding(0, 6, canvas);
    expect(p.top).toBeCloseTo(maxTop, 5);
    expect(p.bottom).toBe(0);
    expect(p.left).toBe(0);
    expect(p.right).toBe(0);
  });

  it("θ=90 (ahead = right) → padding.right only", () => {
    const p = computeLookAheadPadding(90, 6, canvas);
    expect(p.right).toBeCloseTo(maxSide, 5);
    expect(p.top).toBeCloseTo(0, 5);
    expect(p.bottom).toBeCloseTo(0, 5);
    expect(p.left).toBe(0);
  });

  it("θ=180 (ahead = down) → padding.bottom only", () => {
    const p = computeLookAheadPadding(180, 6, canvas);
    expect(p.bottom).toBeCloseTo(maxTop, 5);
    expect(p.top).toBeCloseTo(0, 5);
  });

  it("θ=270 (ahead = left) → padding.left only", () => {
    const p = computeLookAheadPadding(270, 6, canvas);
    expect(p.left).toBeCloseTo(maxSide, 5);
    expect(p.right).toBeCloseTo(0, 5);
  });

  it("θ=45 (ahead = up-right) splits between top and right", () => {
    const p = computeLookAheadPadding(45, 6, canvas);
    const expectedY = maxTop * Math.SQRT1_2;
    const expectedX = maxSide * Math.SQRT1_2;
    expect(p.top).toBeCloseTo(expectedY, 5);
    expect(p.right).toBeCloseTo(expectedX, 5);
    expect(p.bottom).toBeCloseTo(0, 5);
    expect(p.left).toBeCloseTo(0, 5);
  });
});
