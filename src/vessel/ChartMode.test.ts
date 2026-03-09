import type maplibregl from "maplibre-gl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NavigationData } from "../navigation/NavigationData";
import { ChartModeController } from "./ChartMode";

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
});
