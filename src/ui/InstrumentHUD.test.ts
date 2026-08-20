// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveNavigationManager } from "../navigation/ActiveNavigation";
import type { NavigationData } from "../navigation/NavigationData";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import { getSettings, updateSettings } from "../settings";
import { createInstrumentHUD } from "./InstrumentHUD";

/** Minimal fake standing in for NavigationDataManager's subscribe/isFixStale. */
class FakeNavManager {
  private callback: ((data: NavigationData) => void) | null = null;
  subscribe(cb: (data: NavigationData) => void): void {
    this.callback = cb;
  }
  pushFix(): void {
    this.callback?.({
      latitude: 42.3,
      longitude: -71.0,
      sog: 5,
      cog: 90,
    } as NavigationData);
  }
  isFixStale(): boolean {
    return false;
  }
  gpsBatteryInfo(): null {
    return null;
  }
}

function makeNavManager(): NavigationDataManager {
  return new FakeNavManager() as unknown as NavigationDataManager;
}

describe("createInstrumentHUD structural rebuild", () => {
  const originalCells = getSettings().instrumentCells;

  beforeEach(() => {
    vi.useFakeTimers();
    updateSettings({ instrumentCells: ["sog", "cog"], speedUnit: "knots" });
  });

  afterEach(() => {
    vi.useRealTimers();
    updateSettings({ instrumentCells: originalCells });
  });

  it("does not rebuild cell DOM nodes when an unrelated setting changes", () => {
    const handle = createInstrumentHUD(makeNavManager());
    const cellBefore = handle.element.querySelector(".instrument-value");
    expect(cellBefore).not.toBeNull();

    // speedUnit affects only the formatted text (via updateValues), not
    // which cells exist — structure must be left alone.
    updateSettings({ speedUnit: "mph" });

    const cellAfter = handle.element.querySelector(".instrument-value");
    expect(cellAfter).toBe(cellBefore);
  });

  it("rebuilds cell DOM nodes when instrumentCells changes", () => {
    const handle = createInstrumentHUD(makeNavManager());
    const cellBefore = handle.element.querySelector(".instrument-value");
    expect(cellBefore).not.toBeNull();

    updateSettings({ instrumentCells: ["cog", "sog"] });

    const cellAfter = handle.element.querySelector(".instrument-value");
    expect(cellAfter).not.toBeNull();
    expect(cellAfter).not.toBe(cellBefore);
  });
});

describe("nav caption strip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeActiveNav(): ActiveNavigationManager {
    return {
      subscribe: () => {},
      getState: () => ({ type: "route" }),
      getInfo: () => ({
        nextWaypointName: "Nut Island",
        destDistanceNM: 12.42,
      }),
    } as unknown as ActiveNavigationManager;
  }

  it("shows the next waypoint and dest distance once a fix arrives", () => {
    const fakeNav = new FakeNavManager();
    const handle = createInstrumentHUD(
      fakeNav as unknown as NavigationDataManager,
    );
    handle.setActiveNav(makeActiveNav());

    // Before any fix, position-derived dest distance must stay blank.
    const dest = handle.element.querySelector(".instrument-next-wp-dest");
    expect(dest?.textContent).toBe("");

    fakeNav.pushFix();
    const name = handle.element.querySelector(".instrument-next-wp-name");
    expect(name?.textContent).toBe("Next: Nut Island");
    expect(dest?.textContent).toBe("Dest: 12.4 NM");
  });
});
