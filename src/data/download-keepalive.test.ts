// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeepAliveItem } from "./download-keepalive";

const native = vi.hoisted(() => ({
  platform: "android",
  start: vi.fn(),
  stop: vi.fn(),
  stopped: null as null | ((data: { reason: string }) => void),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => native.platform },
}));
vi.mock("../plugins/ChartDownload", () => ({
  ChartDownload: {
    start: native.start,
    stop: native.stop,
    addListener: (_event: string, cb: (data: { reason: string }) => void) => {
      native.stopped = cb;
      return Promise.resolve({ remove: async () => {} });
    },
  },
}));

const { DownloadKeepAlive, keepAliveStatus } = await import(
  "./download-keepalive"
);

const item = (
  state: KeepAliveItem["state"],
  loaded = 0,
  total = 0,
  label = "Gulf Coast",
): KeepAliveItem => ({ label, state, loaded, total });

const visible = { hidden: false, online: true };

describe("keepAliveStatus", () => {
  it("is null for an empty queue", () => {
    expect(keepAliveStatus([], visible)).toBeNull();
  });

  it("shows the active download's label, percent and what is queued behind it", () => {
    expect(
      keepAliveStatus(
        [item("downloading", 42, 100), item("queued", 0, 0, "Hawaii")],
        visible,
      ),
    ).toEqual({ text: "Gulf Coast · 1 more queued", percent: 42 });
  });

  it("shows an indeterminate bar before the size is known", () => {
    expect(keepAliveStatus([item("downloading")], visible)).toEqual({
      text: "Gulf Coast",
      percent: -1,
    });
    expect(keepAliveStatus([item("queued")], visible)).toEqual({
      text: "Gulf Coast",
      percent: -1,
    });
  });

  it("describes a download that is not first in the queue", () => {
    expect(
      keepAliveStatus(
        [item("waiting", 0, 0, "Hawaii"), item("downloading", 1, 4)],
        visible,
      ),
    ).toEqual({ text: "Gulf Coast · 1 more queued", percent: 25 });
  });

  it("keeps running for waiting downloads while they can retry", () => {
    const waiting = [item("waiting"), item("waiting")];
    const status = { text: "Waiting for network…", percent: -1 };
    expect(keepAliveStatus(waiting, visible)).toEqual(status);
    expect(keepAliveStatus(waiting, { hidden: true, online: true })).toEqual(
      status,
    );
    expect(keepAliveStatus(waiting, { hidden: false, online: false })).toEqual(
      status,
    );
  });

  it("stops for waiting downloads when hidden and offline", () => {
    expect(
      keepAliveStatus([item("waiting")], { hidden: true, online: false }),
    ).toBeNull();
    expect(
      keepAliveStatus([item("waiting"), item("queued")], {
        hidden: true,
        online: false,
      }),
    ).not.toBeNull();
  });
});

describe("DownloadKeepAlive", () => {
  let queue: KeepAliveItem[];
  let hidden: boolean;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** Listeners each instance adds, removed after its test. */
  const listeners: [EventTarget, string, EventListener][] = [];

  beforeEach(() => {
    for (const target of [document, window]) {
      const add = target.addEventListener.bind(target);
      vi.spyOn(target, "addEventListener").mockImplementation(
        (type: string, listener: EventListenerOrEventListenerObject | null) => {
          const fn = listener as EventListener;
          listeners.push([target, type, fn]);
          add(type, fn);
        },
      );
    }
    native.platform = "android";
    native.start.mockReset().mockResolvedValue({ running: true });
    native.stop.mockReset().mockResolvedValue(undefined);
    queue = [];
    hidden = false;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
  });

  afterEach(() => {
    for (const [target, type, fn] of listeners.splice(0)) {
      target.removeEventListener(type, fn);
    }
    vi.restoreAllMocks();
  });

  function make() {
    return new DownloadKeepAlive(() => queue);
  }

  it("does nothing off Android", () => {
    native.platform = "web";
    const keepAlive = make();
    queue = [item("downloading", 1, 2)];
    keepAlive.sync();
    expect(native.start).not.toHaveBeenCalled();
    expect(native.stop).not.toHaveBeenCalled();
    expect(keepAlive.running).toBe(false);
  });

  it("stops a leftover service at startup, then only when running", async () => {
    const keepAlive = make();
    expect(native.stop).toHaveBeenCalledTimes(1);
    keepAlive.sync();
    expect(native.stop).toHaveBeenCalledTimes(1);

    queue = [item("downloading", 1, 2)];
    keepAlive.sync();
    await flush();
    expect(keepAlive.running).toBe(true);
    queue = [];
    keepAlive.sync();
    expect(native.stop).toHaveBeenCalledTimes(2);
    expect(keepAlive.running).toBe(false);
  });

  it("starts while visible, and throttles percent-only updates", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const keepAlive = make();
    queue = [item("downloading", 10, 100)];
    keepAlive.sync();
    await flush();
    expect(native.start).toHaveBeenLastCalledWith({
      text: "Gulf Coast",
      percent: 10,
    });

    queue = [item("downloading", 11, 100)];
    keepAlive.sync();
    keepAlive.sync();
    expect(native.start).toHaveBeenCalledTimes(1);

    now.mockReturnValue(3_000);
    keepAlive.sync();
    expect(native.start).toHaveBeenCalledTimes(2);

    queue = [item("downloading", 11, 100), item("queued", 0, 0, "Hawaii")];
    keepAlive.sync();
    expect(native.start).toHaveBeenCalledTimes(3);
    now.mockRestore();
  });

  it("does not start from the background, but updates a running service", async () => {
    const keepAlive = make();
    hidden = true;
    queue = [item("downloading", 1, 4)];
    keepAlive.sync();
    expect(native.start).not.toHaveBeenCalled();

    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(keepAlive.running).toBe(true);

    hidden = true;
    queue = [item("downloading", 1, 4), item("queued")];
    keepAlive.sync();
    expect(native.start).toHaveBeenCalledTimes(2);
  });

  it("reports not running when Android refuses the start", async () => {
    native.start.mockResolvedValue({ running: false });
    const keepAlive = make();
    queue = [item("downloading", 1, 4)];
    keepAlive.sync();
    await flush();
    expect(keepAlive.running).toBe(false);
  });

  it("forgets the service when it stops on its own, and restarts on return", async () => {
    const keepAlive = make();
    queue = [item("downloading", 1, 4)];
    keepAlive.sync();
    await flush();
    hidden = true;
    native.stopped?.({ reason: "timeout" });
    expect(keepAlive.running).toBe(false);

    keepAlive.sync();
    expect(native.start).toHaveBeenCalledTimes(1);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(native.start).toHaveBeenCalledTimes(2);
    expect(keepAlive.running).toBe(true);
  });
});
