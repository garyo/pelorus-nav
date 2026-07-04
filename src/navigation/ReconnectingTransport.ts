/**
 * Shared reconnect state machine for link-based GPS providers (BLE pods,
 * Signal K, Web Serial).
 *
 * The provider owns the transport — how a link is opened, torn down, and any
 * alternate recovery path (advertisement watch, Bluetooth-off detection) —
 * and injects it as {@link ReconnectingTransportOps}. The core owns *when*
 * to (re)try and the bookkeeping every provider used to duplicate:
 *
 * - connect/disconnect intent, and the connected flag derived from it
 * - exponential reconnect backoff (min→max ×2, reset on success)
 * - the silence watchdog (a "connected" link that stops producing data is
 *   dead — force a clean reconnect); runs only while connected
 * - the establishing guard, so a provider's own teardown during (re)connect
 *   isn't mistaken for a peripheral drop
 * - a post-establish intent re-check: if disconnect() raced the establish
 *   await, the fresh link is torn down instead of leaking (on a single-client
 *   peripheral a leaked link holds its only slot)
 * - suspend/resume for "the radio is off, retries are futile" states
 * - relaxed pacing (×10 backoff) for background operation
 */

import { connectionLog } from "./ConnectionEventLog";

export type EstablishCause = "initial" | "restored" | "retry" | "manual";

export interface ReconnectingTransportOps {
  /** Open the link (transport work only — no state bookkeeping). Throws on failure. */
  establish(cause: EstablishCause): Promise<void>;
  /** Runs after a successful establish, once the core has marked the link up. */
  onEstablished(): void;
  /** Close a link that establish() opened after the intent was dropped. */
  teardown(): void;
  /** Gate for timer-driven retries (e.g. "a device has been chosen"). */
  canAttempt?(): boolean;
  /**
   * Alternate recovery after a failed (re)connect — e.g. Web Bluetooth's
   * watchAdvertisements, native Bluetooth-off detection. Return true to idle
   * the core (no backoff timer) until requestRetry()/scheduleReconnect()/
   * resume() wakes it.
   */
  escalateRecovery?(err: unknown): boolean | Promise<boolean>;
  /** When present, timer-driven retries log a connect-attempt with this detail. */
  attemptDetail?(cause: EstablishCause): string;
}

export interface ReconnectingTransportConfig {
  /** Provider id for connectionLog entries (e.g. "ble-nmea"). */
  providerId: string;
  /** Human prefix for console warnings (e.g. "BLE GPS"). */
  logLabel: string;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  silenceLimitMs?: number;
  watchdogMs?: number;
}

const DEFAULT_RECONNECT_MIN_MS = 1000;
const DEFAULT_RECONNECT_MAX_MS = 30000;
const DEFAULT_SILENCE_LIMIT_MS = 8000;
const DEFAULT_WATCHDOG_MS = 4000;
// Relaxed pacing: reconnects can afford to be lazy while the app is hidden
// and not recording — stretch every delay rather than reshaping the sequence.
const RELAXED_BACKOFF_FACTOR = 10;

export class ReconnectingTransport {
  private readonly ops: ReconnectingTransportOps;
  private readonly providerId: string;
  private readonly logLabel: string;
  private readonly reconnectMinMs: number;
  private readonly reconnectMaxMs: number;
  private readonly silenceLimitMs: number;
  private readonly watchdogMs: number;

  private wantConnectedFlag = false;
  private connectedFlag = false;
  private establishing = false;
  private suspended = false;
  private escalated = false;
  private relaxed = false;
  private lastDataMs = 0;
  private reconnectDelayMs = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: ReconnectingTransportConfig,
    ops: ReconnectingTransportOps,
  ) {
    this.ops = ops;
    this.providerId = config.providerId;
    this.logLabel = config.logLabel;
    this.reconnectMinMs = config.reconnectMinMs ?? DEFAULT_RECONNECT_MIN_MS;
    this.reconnectMaxMs = config.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;
    this.silenceLimitMs = config.silenceLimitMs ?? DEFAULT_SILENCE_LIMIT_MS;
    this.watchdogMs = config.watchdogMs ?? DEFAULT_WATCHDOG_MS;
  }

  isConnected(): boolean {
    return this.connectedFlag;
  }

  isReconnecting(): boolean {
    return this.wantConnectedFlag && !this.connectedFlag;
  }

  get wantConnected(): boolean {
    return this.wantConnectedFlag;
  }

  isSuspended(): boolean {
    return this.suspended;
  }

  /**
   * Register the user/app's connect intent. Returns false (and does nothing)
   * if the intent is already held, so callers can early-return.
   */
  noteConnectRequested(): boolean {
    if (this.wantConnectedFlag) return false;
    this.wantConnectedFlag = true;
    connectionLog.log(this.providerId, "connect-request");
    return true;
  }

  /** Drop the intent and quiesce everything (user disconnect). */
  noteDisconnectRequested(): void {
    this.wantConnectedFlag = false;
    this.clearReconnect();
    this.connectedFlag = false;
    this.syncWatchdog();
    connectionLog.log(this.providerId, "disconnected", "user");
  }

  /** Drop the intent quietly (picker cancelled, API unavailable). */
  dropIntent(): void {
    this.wantConnectedFlag = false;
    this.clearReconnect();
    this.syncWatchdog();
  }

  /**
   * Take the intent for a manual retry path (Reconnect button, new-device
   * picker): cancel any pending backoff and start from a clean slate.
   */
  claimIntent(): void {
    this.clearReconnect();
    this.wantConnectedFlag = true;
    this.connectedFlag = false;
    this.syncWatchdog();
  }

  /**
   * Run the provider's establish under the core's guard, then mark the link
   * up and reset the backoff. If the intent was dropped while establish was
   * awaited, the fresh link is torn down instead. Rethrows establish failures
   * (callers decide between backoff, escalation, and picker fallback).
   */
  async runEstablish(cause: EstablishCause): Promise<void> {
    this.establishing = true;
    try {
      await this.ops.establish(cause);
    } finally {
      this.establishing = false;
    }
    if (!this.wantConnectedFlag) {
      this.ops.teardown();
      return;
    }
    this.connectedFlag = true;
    this.lastDataMs = Date.now();
    this.reconnectDelayMs = 0;
    this.syncWatchdog();
    this.ops.onEstablished();
  }

  /**
   * Standard failure handling after a failed (re)connect: try the provider's
   * escalated recovery first; fall back to the backoff timer.
   */
  async noteEstablishFailed(err: unknown): Promise<void> {
    if (await this.ops.escalateRecovery?.(err)) {
      this.escalated = true;
      return;
    }
    this.scheduleReconnect();
  }

  /** Data arrived — feed the silence watchdog. */
  noteData(): void {
    this.lastDataMs = Date.now();
  }

  /**
   * The transport reports the link dropped. Returns false (and does nothing)
   * when it was the provider's own teardown during a (re)connect.
   */
  noteLinkDropped(detail = "peripheral"): boolean {
    if (this.establishing) return false;
    this.connectedFlag = false;
    this.syncWatchdog();
    connectionLog.log(this.providerId, "disconnected", detail);
    if (this.wantConnectedFlag) this.scheduleReconnect();
    return true;
  }

  /** Retries are futile (e.g. Bluetooth off) — go dormant, keep the intent. */
  suspend(): void {
    this.suspended = true;
    this.connectedFlag = false;
    this.clearReconnect();
    this.syncWatchdog();
  }

  /** The obstacle cleared — allow retries again, from a fresh backoff. */
  resume(): void {
    this.suspended = false;
    this.escalated = false;
    this.reconnectDelayMs = 0;
  }

  /** The provider's escalated recovery fired or gave up — leave the idle state. */
  noteEscalationEnded(): void {
    this.escalated = false;
  }

  /** Retry immediately (escalated recovery fired, or pacing turned attentive). */
  requestRetry(): void {
    this.escalated = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    void this.retry();
  }

  scheduleReconnect(): void {
    if (
      !this.wantConnectedFlag ||
      this.suspended ||
      this.escalated ||
      this.reconnectTimer !== null
    ) {
      return;
    }
    this.reconnectDelayMs = this.reconnectDelayMs
      ? Math.min(this.reconnectDelayMs * 2, this.reconnectMaxMs)
      : this.reconnectMinMs;
    const delayMs =
      this.reconnectDelayMs * (this.relaxed ? RELAXED_BACKOFF_FACTOR : 1);
    connectionLog.log(this.providerId, "reconnect-scheduled", `${delayMs}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.retry();
    }, delayMs);
  }

  /**
   * Relaxed pacing stretches reconnect delays ×10 (hidden + not recording).
   * Turning attentive again with a stretched retry pending fires it now —
   * the user is looking at the screen and wants the link back.
   */
  setPacing(relaxed: boolean): void {
    if (this.relaxed === relaxed) return;
    this.relaxed = relaxed;
    if (!relaxed && this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      void this.retry();
    }
  }

  private async retry(): Promise<void> {
    if (!this.wantConnectedFlag || this.suspended) return;
    if (this.ops.canAttempt && !this.ops.canAttempt()) return;
    if (this.ops.attemptDetail) {
      connectionLog.log(
        this.providerId,
        "connect-attempt",
        this.ops.attemptDetail("retry"),
      );
    }
    try {
      await this.runEstablish("retry");
    } catch (err) {
      console.warn(`${this.logLabel} reconnect failed:`, err);
      await this.noteEstablishFailed(err);
    }
  }

  // Detect a "connected" link that has gone silent and force a clean reconnect.
  private checkWatchdog(): void {
    if (!this.wantConnectedFlag || !this.connectedFlag) return;
    if (Date.now() - this.lastDataMs > this.silenceLimitMs) {
      console.warn(`${this.logLabel}: link silent, forcing reconnect`);
      connectionLog.log(this.providerId, "watchdog-silent");
      this.connectedFlag = false;
      this.syncWatchdog();
      void this.retry();
    }
  }

  // The watchdog only has work while a connected link could go silent.
  private syncWatchdog(): void {
    const shouldRun = this.connectedFlag && this.wantConnectedFlag;
    if (shouldRun && this.watchdogTimer === null) {
      this.watchdogTimer = setInterval(
        () => this.checkWatchdog(),
        this.watchdogMs,
      );
    } else if (!shouldRun && this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectDelayMs = 0;
    this.escalated = false;
  }
}
