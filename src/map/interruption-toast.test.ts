import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToastOptions } from "../ui/Toast";

const native = vi.hoisted(() => ({
  platform: "android",
  getBackgroundInfo: vi.fn(),
  openBackgroundSettings: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => native.platform },
}));
vi.mock("../plugins/BackgroundGPS", () => ({
  BackgroundGPS: {
    getBackgroundInfo: native.getBackgroundInfo,
    openBackgroundSettings: native.openBackgroundSettings,
  },
}));
vi.mock("../ui/Toast", () => ({ showToast: native.showToast }));

const MESSAGE = "Track recording stopped for 32m while the app was closed.";

/** A fresh module per test, so the cached manufacturer doesn't leak. */
async function load(): Promise<typeof import("./interruption-toast")> {
  vi.resetModules();
  return import("./interruption-toast");
}

function shownToast(): ToastOptions {
  expect(native.showToast).toHaveBeenCalledTimes(1);
  return native.showToast.mock.calls[0][0] as ToastOptions;
}

describe("showInterruptionToast", () => {
  beforeEach(() => {
    native.platform = "android";
    native.showToast.mockReset();
    native.getBackgroundInfo
      .mockReset()
      .mockResolvedValue({ manufacturer: "google", batteryOptimized: false });
    native.openBackgroundSettings
      .mockReset()
      .mockResolvedValue({ opened: "app-settings" });
  });

  it("offers the background settings on Android", async () => {
    const { showInterruptionToast } = await load();
    await showInterruptionToast(MESSAGE, true);
    const toast = shownToast();
    expect(toast.message).toBe(MESSAGE);
    expect(toast.actionLabel).toBe("Settings");
    expect(toast.durationMs).toBe(12_000);
    toast.onAction?.();
    expect(native.openBackgroundSettings).toHaveBeenCalledTimes(1);
  });

  it("adds the sleeping-apps advice on Samsung, asking the manufacturer once", async () => {
    native.getBackgroundInfo.mockResolvedValue({
      manufacturer: "samsung",
      batteryOptimized: false,
    });
    const { showInterruptionToast } = await load();
    await showInterruptionToast(MESSAGE, true);
    expect(shownToast().message).toContain("Never auto sleeping apps");
    await showInterruptionToast(MESSAGE, true);
    expect(native.getBackgroundInfo).toHaveBeenCalledTimes(1);
  });

  it("still shows the notice when the native side can't say who made the phone", async () => {
    native.getBackgroundInfo.mockRejectedValue(new Error("not implemented"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { showInterruptionToast } = await load();
    await showInterruptionToast(MESSAGE, true);
    expect(shownToast().message).toBe(MESSAGE);
    expect(shownToast().actionLabel).toBe("Settings");
  });

  it("shows the message alone off Android", async () => {
    native.platform = "ios";
    const { showInterruptionToast } = await load();
    await showInterruptionToast(MESSAGE, true);
    expect(shownToast()).toEqual({ message: MESSAGE, durationMs: 12_000 });
    expect(native.getBackgroundInfo).not.toHaveBeenCalled();
  });

  it("shows the message alone when no remedy applies", async () => {
    const { showInterruptionToast } = await load();
    await showInterruptionToast(MESSAGE, false);
    expect(shownToast()).toEqual({ message: MESSAGE, durationMs: 12_000 });
  });
});
