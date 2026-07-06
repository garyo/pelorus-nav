// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachHoldGesture,
  createHoldTimer,
  stepProgress,
} from "./hold-gesture";

describe("createHoldTimer", () => {
  it("reports progress between 0 and 1", () => {
    const t = createHoldTimer(1500, 1000);
    expect(t.progress(1000)).toBe(0);
    expect(t.progress(1750)).toBeCloseTo(0.5);
    expect(t.progress(2500)).toBe(1);
    expect(t.progress(9999)).toBe(1);
    expect(t.progress(500)).toBe(0); // clock skew clamps low
  });

  it("completes exactly at holdMs", () => {
    const t = createHoldTimer(1500, 0);
    expect(t.isComplete(1499)).toBe(false);
    expect(t.isComplete(1500)).toBe(true);
  });

  it("treats non-positive holdMs as instant", () => {
    const t = createHoldTimer(0, 100);
    expect(t.progress(100)).toBe(1);
    expect(t.isComplete(100)).toBe(true);
  });
});

describe("stepProgress", () => {
  it("quantizes into discrete jumps", () => {
    expect(stepProgress(0, 4)).toBe(0);
    expect(stepProgress(0.24, 4)).toBe(0);
    expect(stepProgress(0.25, 4)).toBe(0.25);
    expect(stepProgress(0.74, 4)).toBe(0.5);
    expect(stepProgress(1, 4)).toBe(1);
  });
});

describe("attachHoldGesture (stepped mode, fake clock)", () => {
  let el: HTMLButtonElement;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout",
        "performance",
      ],
    });
    el = document.createElement("button");
    document.body.appendChild(el);
  });

  afterEach(() => {
    vi.useRealTimers();
    el.remove();
  });

  function hold(): {
    progress: number[];
    completed: boolean;
    cancelled: boolean;
    detach: () => void;
  } {
    const result = {
      progress: [] as number[],
      completed: false,
      cancelled: false,
      detach: () => {},
    };
    result.detach = attachHoldGesture(el, {
      holdMs: 1500,
      stepped: () => true,
      onProgress: (f) => result.progress.push(f),
      onComplete: () => {
        result.completed = true;
      },
      onCancel: () => {
        result.cancelled = true;
      },
    });
    return result;
  }

  it("completes after the hold duration via keyboard", () => {
    const r = hold();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    vi.advanceTimersByTime(1600);
    expect(r.completed).toBe(true);
    expect(r.cancelled).toBe(false);
    expect(r.progress.at(-1)).toBe(1);
    r.detach();
  });

  it("cancels on early release without completing", () => {
    const r = hold();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    vi.advanceTimersByTime(500);
    el.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));
    expect(r.completed).toBe(false);
    expect(r.cancelled).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(r.completed).toBe(false);
    r.detach();
  });

  it("emits discrete stepped progress values", () => {
    const r = hold();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    vi.advanceTimersByTime(1400);
    for (const f of r.progress) {
      expect([0, 0.25, 0.5, 0.75, 1]).toContain(f);
    }
    r.detach();
  });

  it("ignores keyboard auto-repeat", () => {
    const r = hold();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    vi.advanceTimersByTime(500);
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", repeat: true }),
    );
    vi.advanceTimersByTime(1100);
    expect(r.completed).toBe(true);
    r.detach();
  });

  it("detach cancels an in-flight hold", () => {
    const r = hold();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    vi.advanceTimersByTime(300);
    r.detach();
    expect(r.cancelled).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(r.completed).toBe(false);
  });
});
