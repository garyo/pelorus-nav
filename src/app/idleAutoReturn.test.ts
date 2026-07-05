import { describe, expect, it, vi } from "vitest";
import { type IdleCloseable, runIdleAutoReturn } from "./idleAutoReturn";

function makeCloseable(busy = false): IdleCloseable & { hide: () => void } {
  return {
    hide: vi.fn(),
    isBusy: () => busy,
  };
}

describe("runIdleAutoReturn", () => {
  it("hides every closeable when none report busy", () => {
    const a = makeCloseable(false);
    const b = makeCloseable(false);
    const result = runIdleAutoReturn([a, b]);
    expect(a.hide).toHaveBeenCalledTimes(1);
    expect(b.hide).toHaveBeenCalledTimes(1);
    expect(result.anyBusy).toBe(false);
  });

  it("skips hiding a busy closeable but still hides the rest", () => {
    const busyDownload = makeCloseable(true);
    const idlePanel = makeCloseable(false);
    const result = runIdleAutoReturn([busyDownload, idlePanel]);
    expect(busyDownload.hide).not.toHaveBeenCalled();
    expect(idlePanel.hide).toHaveBeenCalledTimes(1);
    expect(result.anyBusy).toBe(true);
  });

  it("treats a closeable with no isBusy() as never busy", () => {
    const plain: IdleCloseable = { hide: vi.fn() };
    const result = runIdleAutoReturn([plain]);
    expect(plain.hide).toHaveBeenCalledTimes(1);
    expect(result.anyBusy).toBe(false);
  });
});
