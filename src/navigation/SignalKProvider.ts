/**
 * Signal K provider via WebSocket.
 * Connects to a Signal K server (?subscribe=none) and subscribes explicitly to
 * the navigation paths, at a period the manager can hint (adaptive rate).
 *
 * The reconnect state machine (intent, backoff, silence watchdog) lives in
 * ReconnectingTransport, so a server reboot, a dropped WiFi link, or a
 * half-open socket recovers without the user toggling the GPS source.
 */

import { toDegrees } from "../utils/coordinates";
import { getDeclination } from "../utils/magnetic";
import { MS_TO_KNOTS } from "../utils/units";
import { connectionLog } from "./ConnectionEventLog";
import type {
  NavigationData,
  NavigationDataCallback,
  NavigationDataProvider,
} from "./NavigationData";
import type { ProviderNotice } from "./ProviderNotice";
import { ReconnectingTransport } from "./ReconnectingTransport";
import { SignalKDiagnostics } from "./signalk-diagnostics";

// Subscription period bounds: the server quantizes anyway, and anything
// faster than 1 s or slower than 10 s buys nothing for navigation.
const MIN_PERIOD_MS = 1000;
const MAX_PERIOD_MS = 10000;

// Signal K servers legitimately send `"value": null` when a quantity is
// unknown (e.g. COG/SOG from an NMEA source without a fix); anything
// non-finite must read as "unknown", never coerce to 0.
function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A radians value as degrees; non-numbers (incl. null) read as unknown. */
function asDegrees(value: unknown): number | null {
  const rad = asFiniteNumber(value);
  return rad === null ? null : toDegrees(rad);
}

function asPosition(
  value: unknown,
): { latitude: number; longitude: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const pos = value as { latitude?: unknown; longitude?: unknown };
  const latitude = asFiniteNumber(pos.latitude);
  const longitude = asFiniteNumber(pos.longitude);
  return latitude !== null && longitude !== null
    ? { latitude, longitude }
    : null;
}

// A healthy server sends every period; several missed periods means the
// link is dead even if the socket still looks open (half-open TCP).
function silenceLimitFor(periodMs: number): number {
  return Math.max(10000, periodMs * 4);
}

export class SignalKProvider implements NavigationDataProvider {
  readonly id = "signalk";
  readonly name = "Signal K";
  readonly external = true;

  private listeners: NavigationDataCallback[] = [];
  private ws: WebSocket | null = null;
  /** Stream URL; null until the user has entered a server address. */
  private url: string | null;
  private periodMs = 1000;
  private readonly core: ReconnectingTransport;
  private readonly onNotice?: (notice: ProviderNotice) => void;

  /** Everything this connection has seen, for the diagnostics panel. */
  readonly diagnostics = new SignalKDiagnostics();
  /** While true, also subscribe to every own-vessel path and other vessels. */
  private inspecting = false;

  // Latest values from partial updates, carried onto the next position fix.
  // Headings stay in degrees as received (true, or magnetic + variation).
  private cog: number | null = null;
  private sog: number | null = null;
  private headingTrue: number | null = null;
  private headingMagnetic: number | null = null;
  private variation: number | null = null;
  // Identity (server timestamp + coordinates) of the last position emitted:
  // the same measurement arriving through two subscriptions must count as one
  // fix. Coordinates too, because some GPSs stamp only whole seconds.
  private lastPositionKey: string | null = null;

  constructor(url: string | null, onNotice?: (notice: ProviderNotice) => void) {
    this.url = url;
    this.onNotice = onNotice;
    this.core = new ReconnectingTransport(
      {
        providerId: this.id,
        logLabel: "Signal K",
        silenceLimitMs: silenceLimitFor(this.periodMs),
      },
      {
        establish: () => this.openSocket(),
        onEstablished: () => this.handleEstablished(),
        teardown: () => this.teardownSocket(),
        attemptDetail: (cause) => `${this.url} (${cause})`,
      },
    );
  }

  /** The stream URL in use, or null while no server is entered. */
  get streamUrl(): string | null {
    return this.url;
  }

  isConnected(): boolean {
    return this.core.isConnected();
  }

  lastRawDataMs(): number {
    return this.core.lastRawDataMs();
  }

  /** What the server has sent, for bug reports (see SignalKDiagnostics). */
  requestDeviceDiag(): Promise<string | null> {
    if (this.url === null) return Promise.resolve(null);
    return Promise.resolve(
      `${this.url}\n${this.diagnostics.summary(Date.now(), this.isConnected())}`,
    );
  }

  /** False while no server is entered: nothing is being retried. */
  isReconnecting(): boolean {
    return this.url !== null && this.core.isReconnecting();
  }

  connect(): void {
    if (!this.core.noteConnectRequested()) return;
    // No server entered yet: hold the intent but stay dormant (no attempts,
    // no "cannot reach" notices) until setUrl supplies an address.
    if (this.url === null) {
      this.core.suspend();
      return;
    }
    void this.startConnect();
  }

  disconnect(): void {
    this.core.noteDisconnectRequested();
    this.teardownSocket();
  }

  /** Manual reconnect (UI button): drop the current socket and retry now. */
  async reconnect(): Promise<void> {
    if (this.url === null) return;
    this.teardownSocket();
    this.core.claimIntent();
    try {
      connectionLog.log(this.id, "connect-attempt", `${this.url} (manual)`);
      await this.core.runEstablish("manual");
    } catch (err) {
      console.warn("Signal K manual reconnect failed:", err);
      await this.core.noteEstablishFailed(err);
    }
  }

  subscribe(callback: NavigationDataCallback): void {
    this.listeners.push(callback);
  }

  unsubscribe(callback: NavigationDataCallback): void {
    const idx = this.listeners.indexOf(callback);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  setUrl(url: string | null): void {
    if (url === this.url) return;
    this.url = url;
    if (!this.core.wantConnected) return;
    // Move the connection to the new server: drop the old socket quietly and
    // retry immediately (the stale socket's close event is ignored by the
    // this.ws identity guard). A cleared address goes dormant instead.
    this.teardownSocket();
    if (url === null) {
      this.core.suspend();
      return;
    }
    this.core.claimIntent();
    this.core.requestRetry();
  }

  /**
   * Rate hint from the manager (adaptive tiers). Clamped to 1–10 s and
   * quantized to whole seconds — the wire format takes ms but servers
   * schedule in seconds. Re-subscribes on the live socket; the silence
   * limit scales with the period so slow tiers aren't misread as death.
   */
  setDesiredIntervalMs(ms: number): void {
    const clamped = Math.min(MAX_PERIOD_MS, Math.max(MIN_PERIOD_MS, ms));
    const period = Math.round(clamped / 1000) * 1000;
    if (period === this.periodMs) return;
    this.periodMs = period;
    this.core.setSilenceLimitMs(silenceLimitFor(period));
    const sock = this.ws;
    if (sock && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify({ context: "*", unsubscribe: [{ path: "*" }] }));
      this.sendSubscription(sock);
    }
  }

  private async startConnect(): Promise<void> {
    try {
      connectionLog.log(this.id, "connect-attempt", `${this.url} (initial)`);
      await this.core.runEstablish("initial");
    } catch (err) {
      console.warn("Signal K connect failed, retrying:", err);
      connectionLog.log(this.id, "error", `connect: ${String(err)}`);
      this.onNotice?.({
        kind: "connect-failed",
        detail: `cannot reach ${this.url}`,
      });
      await this.core.noteEstablishFailed(err);
    }
  }

  // Open the WebSocket and resolve once it's usable (rejects on a close or
  // error before open). Post-open lifecycle flows through the core: messages
  // feed the watchdog, an unexpected close schedules a reconnect.
  private openSocket(): Promise<void> {
    // A watchdog-forced retry finds this.ws still pointing at a live (if
    // silent) socket — close it before replacing, or its onmessage/onclose
    // handlers just early-return on the identity guard forever, leaking one
    // subscribed connection per silence trip.
    this.teardownSocket();
    const url = this.url;
    if (url === null) return Promise.reject(new Error("no server address"));
    return new Promise((resolve, reject) => {
      const sock = new WebSocket(url);
      let opened = false;
      this.ws = sock;
      sock.onopen = () => {
        opened = true;
        this.sendSubscription(sock);
        resolve();
      };
      sock.onmessage = (event) => {
        if (this.ws !== sock) return; // stale socket
        this.core.noteData();
        try {
          const msg = JSON.parse(event.data as string);
          this.handleMessage(msg);
        } catch {
          // ignore parse errors
        }
      };
      sock.onerror = () => {
        console.warn("Signal K WebSocket error");
        // Reject here too (no-op after open): some runtimes deliver the
        // close event late or not at all on a failed handshake, and the
        // establish must not hang on it.
        reject(new Error("connection failed"));
      };
      sock.onclose = () => {
        // Identity guard: a torn-down socket's close event must not clobber
        // the replacement link's state (the close-race bug).
        if (this.ws !== sock) return;
        this.ws = null;
        if (!opened) {
          reject(new Error("connection closed")); // failed before open
          return;
        }
        if (this.core.noteLinkDropped("server")) {
          this.onNotice?.({
            kind: "connect-failed",
            detail: "server connection lost",
          });
        }
      };
    });
  }

  private handleEstablished(): void {
    this.diagnostics.noteConnected(Date.now());
    connectionLog.log(this.id, "connected", this.url ?? undefined);
    this.onNotice?.({ kind: "connected" });
  }

  // Close whatever socket is current, quietly: nulling this.ws first makes
  // the identity guard swallow the resulting close event. Also forgets the
  // carried COG/SOG/heading — openSocket tears down before opening every
  // replacement, so a new connection's fixes never wear a previous server's
  // course (e.g. after setUrl). Positions are never carried at all: each fix
  // takes its position from the message that emits it.
  private teardownSocket(): void {
    const sock = this.ws;
    this.ws = null;
    sock?.close();
    this.cog = null;
    this.sog = null;
    this.headingTrue = null;
    this.headingMagnetic = null;
    this.variation = null;
    this.lastPositionKey = null;
  }

  /**
   * Widen the subscription to every own-vessel path, plus other vessels'
   * positions, while the diagnostics panel is open; narrow it again after.
   */
  setInspecting(on: boolean): void {
    if (on === this.inspecting) return;
    this.inspecting = on;
    const sock = this.ws;
    if (sock && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify({ context: "*", unsubscribe: [{ path: "*" }] }));
      this.sendSubscription(sock);
    }
  }

  private sendSubscription(sock: WebSocket): void {
    const period = this.periodMs;
    sock.send(
      JSON.stringify({
        context: "vessels.self",
        subscribe: [
          { path: "navigation.position", period },
          { path: "navigation.courseOverGroundTrue", period },
          { path: "navigation.speedOverGround", period },
          { path: "navigation.headingTrue", period },
          { path: "navigation.headingMagnetic", period },
          { path: "navigation.magneticVariation", period },
        ],
      }),
    );
    if (!this.inspecting) return;
    sock.send(
      JSON.stringify({
        context: "vessels.self",
        subscribe: [{ path: "*", period: 1000 }],
      }),
    );
    sock.send(
      JSON.stringify({
        context: "vessels.*",
        subscribe: [{ path: "navigation.position", period: 5000 }],
      }),
    );
  }

  private handleMessage(msg: Record<string, unknown>): void {
    // The hello and other vessels' deltas feed diagnostics only.
    if (!this.diagnostics.noteMessage(msg, Date.now())) return;
    const updates = msg.updates as Array<{
      timestamp?: unknown;
      values?: Array<{ path: string; value: unknown }>;
    }>;

    // A fix is emitted only for a message carrying a position. Real servers
    // (signalk-server) deliver each subscribed path as its own delta, so
    // emitting on every COG/SOG/heading message would restamp the last
    // position as a fresh fix several times a period; those values are held
    // and ride on the next position instead (at most one period late).
    let position: { latitude: number; longitude: number } | null = null;
    let positionStamp: string | null = null;

    for (const update of updates) {
      for (const { path, value } of update.values ?? []) {
        switch (path) {
          case "navigation.position": {
            // A malformed position is skipped; the rest of the message stands.
            const pos = asPosition(value);
            if (!pos) break;
            position = pos;
            positionStamp =
              typeof update.timestamp === "string" ? update.timestamp : null;
            break;
          }
          case "navigation.courseOverGroundTrue":
            this.cog = asDegrees(value);
            break;
          case "navigation.speedOverGround": {
            const mps = asFiniteNumber(value);
            this.sog = mps === null ? null : mps * MS_TO_KNOTS;
            break;
          }
          case "navigation.headingTrue":
            this.headingTrue = asDegrees(value);
            break;
          case "navigation.headingMagnetic":
            this.headingMagnetic = asDegrees(value);
            break;
          case "navigation.magneticVariation":
            this.variation = asDegrees(value);
            break;
        }
      }
    }

    if (!position) return;
    if (positionStamp !== null) {
      const key = `${positionStamp} ${position.latitude} ${position.longitude}`;
      if (key === this.lastPositionKey) return;
      this.lastPositionKey = key;
    }
    const data: NavigationData = {
      latitude: position.latitude,
      longitude: position.longitude,
      cog: this.cog,
      sog: this.sog,
      heading: this.trueHeading(position.latitude, position.longitude),
      accuracy: null,
      timestamp: Date.now(),
      source: "signalk",
    };
    for (const fn of this.listeners) {
      fn(data);
    }
  }

  /**
   * True heading: the server's headingTrue when it has one; otherwise a
   * magnetic compass heading corrected by the server's variation, or by the
   * charted declination here when the server doesn't provide one.
   */
  private trueHeading(lat: number, lon: number): number | null {
    if (this.headingTrue !== null) return this.headingTrue;
    if (this.headingMagnetic === null) return null;
    const variation = this.variation ?? getDeclination(lat, lon);
    return (((this.headingMagnetic + variation) % 360) + 360) % 360;
  }
}
