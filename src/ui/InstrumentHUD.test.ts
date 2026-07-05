// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NavigationDataManager } from "../navigation/NavigationDataManager";
import { getSettings, updateSettings } from "../settings";
import { createInstrumentHUD } from "./InstrumentHUD";

/** Minimal fake standing in for NavigationDataManager's subscribe/isFixStale. */
class FakeNavManager {
  subscribe(): void {}
  isFixStale(): boolean {
    return false;
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
