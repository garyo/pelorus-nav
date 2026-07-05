import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReconnectingTransportOps } from "./ReconnectingTransport";
import { ReconnectingTransport } from "./ReconnectingTransport";

// A controllable fake transport: establish() succeeds or fails on demand.

function makeHarness(opsOverrides: Partial<ReconnectingTransportOps> = {}) {
  const calls = {
    establish: 0,
    onEstablished: 0,
    teardown: 0,
    escalate: 0,
  };
  const control = { failTimes: 0 };
  const ops: ReconnectingTransportOps = {
    establish: () => {
      calls.establish++;
      if (control.failTimes > 0) {
        control.failTimes--;
        return Promise.reject(new Error("establish failed"));
      }
      return Promise.resolve();
    },
    onEstablished: () => {
      calls.onEstablished++;
    },
    teardown: () => {
      calls.teardown++;
    },
    ...opsOverrides,
  };
  const core = new ReconnectingTransport(
    { providerId: "test-link", logLabel: "Test link" },
    ops,
  );
  return { core, calls, control };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("ReconnectingTransport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("marks the link up after a successful establish", async () => {
    const { core, calls } = makeHarness();
    core.noteConnectRequested();
    await core.runEstablish("initial");

    expect(core.isConnected()).toBe(true);
    expect(core.isReconnecting()).toBe(false);
    expect(calls.onEstablished).toBe(1);
  });

  it("retries on an exponential backoff that caps at 30s", async () => {
    const { core, calls, control } = makeHarness();
    core.noteConnectRequested();
    await core.runEstablish("initial");

    control.failTimes = 7; // every retry fails until the cap is exercised
    core.noteLinkDropped();
    expect(core.isReconnecting()).toBe(true);

    // Delays double 1s → 30s cap: attempts at +1s, +2s, +4s, +8s, +16s, +30s, +30s.
    const delays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    let attempts = 1; // the initial establish
    for (const delay of delays) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(calls.establish).toBe(attempts); // not yet
      await vi.advanceTimersByTimeAsync(1);
      attempts++;
      expect(calls.establish).toBe(attempts);
    }
    // The 8th retry succeeds and resets the backoff...
    await vi.advanceTimersByTimeAsync(30000);
    expect(core.isConnected()).toBe(true);

    // ...so the next drop starts over at 1s.
    control.failTimes = 0;
    core.noteLinkDropped();
    const before = calls.establish;
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.establish).toBe(before + 1);
    expect(core.isConnected()).toBe(true);
  });

  it("forces a reconnect when a connected link goes silent", async () => {
    const { core, calls } = makeHarness();
    core.noteConnectRequested();
    await core.runEstablish("initial");

    // Data keeps the watchdog fed.
    await vi.advanceTimersByTimeAsync(6000);
    core.noteData();
    await vi.advanceTimersByTimeAsync(6000);
    core.noteData();
    expect(calls.establish).toBe(1);

    // Silence past the limit trips the watchdog on its next tick.
    await vi.advanceTimersByTimeAsync(12000);
    expect(calls.establish).toBe(2);
    expect(core.isConnected()).toBe(true); // reconnect succeeded
  });

  it("does not run the watchdog while disconnected", async () => {
    const { core, calls, control } = makeHarness();
    core.noteConnectRequested();
    control.failTimes = 1;
    await expect(core.runEstablish("initial")).rejects.toThrow();

    // Never connected — hours of silence must not trip the watchdog.
    await vi.advanceTimersByTimeAsync(60000);
    expect(calls.establish).toBe(1);
    expect(core.isConnected()).toBe(false);
  });

  it("tears down a link established after the intent was dropped", async () => {
    let resolveEstablish: () => void = () => {};
    const { core, calls } = makeHarness({
      establish: () =>
        new Promise<void>((resolve) => {
          resolveEstablish = resolve;
        }),
    });
    core.noteConnectRequested();
    const establishing = core.runEstablish("initial");

    core.noteDisconnectRequested(); // disconnect() races the await
    resolveEstablish();
    await establishing;

    expect(calls.teardown).toBe(1);
    expect(calls.onEstablished).toBe(0);
    expect(core.isConnected()).toBe(false);
  });

  it("ignores a link-drop report during establish", async () => {
    let resolveEstablish: () => void = () => {};
    const { core } = makeHarness({
      establish: () =>
        new Promise<void>((resolve) => {
          resolveEstablish = resolve;
        }),
    });
    core.noteConnectRequested();
    const establishing = core.runEstablish("initial");

    expect(core.noteLinkDropped()).toBe(false); // our own teardown mid-connect
    resolveEstablish();
    await establishing;
    expect(core.isConnected()).toBe(true);
  });

  it("a stale establish resolving after supersession does not flip state or fire onEstablished again", async () => {
    const resolvers: Array<() => void> = [];
    const { core, calls } = makeHarness({
      establish: () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    });
    core.noteConnectRequested();
    const first = core.runEstablish("initial"); // establish #1: pending
    const second = core.runEstablish("manual"); // races #1 — the newer attempt

    resolvers[1](); // #2 (newer) resolves first
    await second;
    expect(core.isConnected()).toBe(true);
    expect(calls.onEstablished).toBe(1);

    resolvers[0](); // #1 (stale) resolves late
    await first;
    expect(core.isConnected()).toBe(true); // unchanged by the stale attempt
    expect(calls.onEstablished).toBe(1); // not re-fired
    expect(calls.teardown).toBe(0); // must not tear down the live newer link
  });

  it("noteLinkDropped stays guarded until the latest of two overlapping establishes settles", async () => {
    const resolvers: Array<() => void> = [];
    const { core } = makeHarness({
      establish: () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    });
    core.noteConnectRequested();
    const first = core.runEstablish("initial");
    const second = core.runEstablish("manual");

    // While either attempt is still in flight, a drop report during this
    // window must be classified as our own establish noise, not a real drop.
    expect(core.noteLinkDropped()).toBe(false);

    resolvers[0](); // stale settles first — must not clear the in-flight guard
    await first;
    expect(core.noteLinkDropped()).toBe(false);

    resolvers[1](); // the current attempt settles
    await second;
    expect(core.isConnected()).toBe(true);
    // Now a drop report reflects a real peripheral event.
    expect(core.noteLinkDropped()).toBe(true);
  });

  it("escalated recovery suppresses the backoff timer until requestRetry", async () => {
    const { core, calls, control } = makeHarness({
      escalateRecovery: () => true,
    });
    core.noteConnectRequested();
    await core.runEstablish("initial");

    control.failTimes = 1;
    core.noteLinkDropped(); // schedules the 1s retry
    await vi.advanceTimersByTimeAsync(1000); // retry fails → escalates

    await vi.advanceTimersByTimeAsync(120000); // idle: no backoff polling
    expect(calls.establish).toBe(2);

    core.requestRetry(); // the provider's recovery path fired
    await flush();
    expect(calls.establish).toBe(3);
    expect(core.isConnected()).toBe(true);
  });

  it("suspend() goes dormant keeping the intent; resume() allows retries", async () => {
    const { core, calls } = makeHarness();
    core.noteConnectRequested();
    await core.runEstablish("initial");

    core.noteLinkDropped(); // schedules a retry
    core.suspend(); // radio went off — retries are futile
    await vi.advanceTimersByTimeAsync(120000);
    expect(calls.establish).toBe(1); // no attempts while suspended
    expect(core.isReconnecting()).toBe(true); // intent survives

    core.resume();
    core.scheduleReconnect();
    await vi.advanceTimersByTimeAsync(1000); // fresh backoff from the minimum
    expect(calls.establish).toBe(2);
    expect(core.isConnected()).toBe(true);
  });

  it("claimIntent() clears suspended, so retries after a manual reconnect during suspension are not swallowed", async () => {
    const { core } = makeHarness();
    core.noteConnectRequested();
    await core.runEstablish("initial");

    core.suspend(); // e.g. Bluetooth went off — retries are futile
    core.claimIntent(); // Reconnect button tapped while suspended
    await core.runEstablish("manual"); // succeeds (e.g. the radio was back)
    expect(core.isConnected()).toBe(true);

    core.noteLinkDropped(); // a later, real drop
    expect(core.isReconnecting()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000); // backoff must actually retry
    expect(core.isConnected()).toBe(true);
  });

  it("relaxed pacing stretches delays ×10 and retries at once when attentive", async () => {
    const { core, calls, control } = makeHarness();
    core.noteConnectRequested();
    await core.runEstablish("initial");

    core.setPacing(true);
    control.failTimes = 1;
    core.noteLinkDropped(); // 1s base delay → 10s relaxed
    await vi.advanceTimersByTimeAsync(9999);
    expect(calls.establish).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.establish).toBe(2); // fails → next delay 2s base → 20s relaxed

    await vi.advanceTimersByTimeAsync(5000); // stretched retry still pending
    core.setPacing(false); // screen visible again
    await flush();
    expect(calls.establish).toBe(3); // retried immediately
    expect(core.isConnected()).toBe(true);
  });
});
