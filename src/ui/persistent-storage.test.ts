// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const saved = vi.hoisted(() => ({ navData: false, charts: 0 }));
vi.mock("../data/db", () => ({
  hasSavedNavData: async () => saved.navData,
}));
vi.mock("../data/tile-store", () => ({
  listStoredCharts: async () => new Array(saved.charts).fill({}),
}));

/** A navigator.storage whose persist() answers after `answerMs`. */
function stubStorage(answerMs: number, persisted = false) {
  const storage = {
    persisted: vi.fn().mockResolvedValue(persisted),
    persist: vi.fn(
      () =>
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(true), answerMs),
        ),
    ),
  };
  Object.defineProperty(navigator, "storage", {
    value: storage,
    configurable: true,
  });
  return storage;
}

const toastText = () => document.querySelector(".app-toast")?.textContent;

// A fresh module per test: it asks at most once per session.
async function load() {
  vi.resetModules();
  return import("./persistent-storage");
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  saved.navData = false;
  saved.charts = 0;
});

describe("requestPersistentStorage", () => {
  it("explains the browser's prompt while it waits for the user", async () => {
    const storage = stubStorage(5000);
    const { requestPersistentStorage, PERSIST_PROMPT_MESSAGE } = await load();
    const done = requestPersistentStorage();
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.persist).toHaveBeenCalledOnce();
    expect(toastText()).toBe(PERSIST_PROMPT_MESSAGE);
    await vi.advanceTimersByTimeAsync(4000);
    await done;
  });

  it("shows nothing when the browser answers without asking", async () => {
    stubStorage(10);
    const { requestPersistentStorage } = await load();
    const done = requestPersistentStorage();
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    expect(toastText()).toBeUndefined();
  });

  it("asks once per session, and not at all when already persisted", async () => {
    let storage = stubStorage(10);
    let mod = await load();
    await Promise.all([
      mod.requestPersistentStorage(),
      mod.requestPersistentStorage(),
      vi.advanceTimersByTimeAsync(100),
    ]);
    expect(storage.persist).toHaveBeenCalledOnce();

    storage = stubStorage(10, true);
    mod = await load();
    await mod.requestPersistentStorage();
    expect(storage.persist).not.toHaveBeenCalled();
  });
});

describe("requestPersistentStorageOnLaunch", () => {
  it("waits until something has been saved", async () => {
    const storage = stubStorage(10);
    let mod = await load();
    await mod.requestPersistentStorageOnLaunch();
    expect(storage.persisted).not.toHaveBeenCalled();

    saved.navData = true;
    mod = await load();
    await Promise.all([
      mod.requestPersistentStorageOnLaunch(),
      vi.advanceTimersByTimeAsync(100),
    ]);
    expect(storage.persist).toHaveBeenCalledOnce();
  });

  it("counts downloaded charts as saved data", async () => {
    saved.charts = 1;
    const storage = stubStorage(10);
    const mod = await load();
    await Promise.all([
      mod.requestPersistentStorageOnLaunch(),
      vi.advanceTimersByTimeAsync(100),
    ]);
    expect(storage.persist).toHaveBeenCalledOnce();
  });
});
