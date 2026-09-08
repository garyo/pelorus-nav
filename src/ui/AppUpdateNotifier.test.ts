// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startAppUpdateNotifier } from "./AppUpdateNotifier";

class FakeServiceWorkerContainer extends EventTarget {
  controller: object | null = null;
  register = vi.fn().mockResolvedValue({
    update: vi.fn().mockResolvedValue(undefined),
  });
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function noticeEl(): HTMLElement | null {
  return document.getElementById("app-update-notice");
}

function laterButton(): HTMLButtonElement {
  const buttons = noticeEl()?.querySelectorAll("button");
  if (!buttons || buttons.length < 2) throw new Error("notice not showing");
  return buttons[buttons.length - 1] as HTMLButtonElement;
}

describe("startAppUpdateNotifier", () => {
  let sw: FakeServiceWorkerContainer;
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    setVisibility("visible");
    sw = new FakeServiceWorkerContainer();
    Object.defineProperty(navigator, "serviceWorker", {
      value: sw,
      configurable: true,
    });
    reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadSpy },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('"Later" cancels both the idle reload and the visibilitychange reload', () => {
    sw.controller = {}; // already controlled — next controllerchange is a real update
    startAppUpdateNotifier();
    sw.dispatchEvent(new Event("controllerchange"));

    expect(noticeEl()).not.toBeNull();
    laterButton().click();
    expect(noticeEl()).toBeNull();

    vi.advanceTimersByTime(60_000);
    expect(reloadSpy).not.toHaveBeenCalled();

    setVisibility("hidden");
    setVisibility("visible");
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("an uncontrolled first load skips the initial claim but reacts to the next controllerchange", () => {
    sw.controller = null; // fresh install: no controller yet
    startAppUpdateNotifier();

    // clientsClaim's initial claim — not a real update.
    sw.dispatchEvent(new Event("controllerchange"));
    expect(noticeEl()).toBeNull();

    // A genuine later update.
    sw.dispatchEvent(new Event("controllerchange"));
    expect(noticeEl()).not.toBeNull();
  });

  it("skips the periodic and on-return polls while update checks are off", async () => {
    startAppUpdateNotifier(
      () => false,
      () => false,
    );
    await Promise.resolve(); // let register() resolve and arm the polls
    const registration = await sw.register.mock.results[0]?.value;

    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    setVisibility("hidden");
    setVisibility("visible");
    expect(registration.update).not.toHaveBeenCalled();
  });

  it("polls on return to the foreground when update checks are on", async () => {
    startAppUpdateNotifier(
      () => false,
      () => true,
    );
    await Promise.resolve();
    const registration = await sw.register.mock.results[0]?.value;

    setVisibility("hidden");
    setVisibility("visible");
    expect(registration.update).toHaveBeenCalledOnce();
  });

  it("defers the reload while the app reports itself busy (navigating/recording)", () => {
    sw.controller = {};
    let busy = true;
    startAppUpdateNotifier(() => busy);
    sw.dispatchEvent(new Event("controllerchange"));
    expect(noticeEl()).not.toBeNull();

    vi.advanceTimersByTime(10_000);
    expect(reloadSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    expect(reloadSpy).not.toHaveBeenCalled();

    busy = false;
    vi.advanceTimersByTime(10_000);
    expect(reloadSpy).toHaveBeenCalledOnce();
  });
});
