// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionEventLog } from "../navigation/ConnectionEventLog";
import {
  formatErrorDetail,
  installGlobalErrorCapture,
  resetGlobalErrorCaptureForTests,
} from "./errorLog";

function makeLog(): ConnectionEventLog {
  return new ConnectionEventLog({ storage: null });
}

function fireError(err: Error): void {
  window.dispatchEvent(
    new ErrorEvent("error", { error: err, message: err.message }),
  );
}

function fireRejection(reason: unknown): void {
  // jsdom lacks a PromiseRejectionEvent constructor with reason in some
  // versions — synthesize a plain event and patch the field.
  const event = new Event("unhandledrejection");
  (event as unknown as { reason: unknown }).reason = reason;
  window.dispatchEvent(event);
}

describe("errorLog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T12:00:00Z"));
    resetGlobalErrorCaptureForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetGlobalErrorCaptureForTests();
  });

  it("persists under its own key, never the connection-log key", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
    };
    const log = new ConnectionEventLog({
      storage,
      key: "pelorus-nav-error-log",
      max: 100,
    });
    log.log("js-error", "error", "boom");
    log.flush(); // persist is debounced — force it through for this assertion
    expect(map.has("pelorus-nav-error-log")).toBe(true);
    expect(map.has("pelorus-nav-conn-log")).toBe(false);
  });

  it("captures window error events with message and stack head", () => {
    const log = makeLog();
    installGlobalErrorCapture(log, window);
    const err = new Error("kaboom");
    err.stack =
      "Error: kaboom\n  at a.ts:1\n  at b.ts:2\n  at c.ts:3\n  at d.ts:4\n  at e.ts:5";
    fireError(err);
    expect(log.entryCount).toBe(1);
    const detail = log.getEntries()[0].detail ?? "";
    expect(detail).toContain("kaboom");
    expect(detail).toContain("c.ts:3"); // within the 4-line stack head
    expect(detail).not.toContain("e.ts:5"); // beyond the cap
  });

  it("captures unhandledrejection reasons, including non-Error reasons", () => {
    const log = makeLog();
    installGlobalErrorCapture(log, window);
    fireRejection({ code: 7 });
    expect(log.entryCount).toBe(1);
    expect(log.getEntries()[0].src).toBe("unhandled-rejection");
    expect(log.getEntries()[0].detail).toBe('{"code":7}');
  });

  it("suppresses consecutive identical errors and flushes a repeated xN entry", () => {
    const log = makeLog();
    installGlobalErrorCapture(log, window);
    const err = new Error("same");
    fireError(err);
    fireError(err);
    fireError(err);
    expect(log.entryCount).toBe(1); // duplicates suppressed

    fireError(new Error("different"));
    const details = log.getEntries().map((e) => e.detail);
    expect(details.some((d) => d?.includes("repeated x2"))).toBe(true);
    expect(log.entryCount).toBe(3); // same, repeated-marker, different
  });

  it("caps entries per minute during a storm of distinct errors", () => {
    const log = makeLog();
    installGlobalErrorCapture(log, window);
    for (let i = 0; i < 40; i++) {
      fireError(new Error(`distinct-${i}`));
    }
    // 20 logged + 1 storm marker
    expect(log.entryCount).toBe(21);
    expect(
      log.getEntries().some((e) => e.detail?.includes("error storm")),
    ).toBe(true);

    vi.advanceTimersByTime(61_000);
    fireError(new Error("after the storm"));
    expect(log.getEntries().at(-1)?.detail?.includes("after the storm")).toBe(
      true,
    );
  });

  it("installGlobalErrorCapture is idempotent", () => {
    const log = makeLog();
    installGlobalErrorCapture(log, window);
    installGlobalErrorCapture(log, window); // second install must not double-log
    fireError(new Error("once"));
    expect(log.entryCount).toBe(1);
  });

  it("formatErrorDetail handles strings and circular objects", () => {
    expect(formatErrorDetail("plain")).toBe("plain");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(typeof formatErrorDetail(circular)).toBe("string");
  });
});
