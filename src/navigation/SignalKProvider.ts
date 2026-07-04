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
import { MS_TO_KNOTS } from "../utils/units";
import { connectionLog } from "./ConnectionEventLog";
import type {
  NavigationData,
  NavigationDataCallback,
  NavigationDataProvider,
} from "./NavigationData";
import type { ProviderNotice } from "./ProviderNotice";
import { ReconnectingTransport } from "./ReconnectingTransport";

// Subscription period bounds: the server quantizes anyway, and anything
// faster than 1 s or slower than 10 s buys nothing for navigation.
const MIN_PERIOD_MS = 1000;
const MAX_PERIOD_MS = 10000;

// A healthy server sends every period; several missed periods means the
// link is dead even if the socket still looks open (half-open TCP).
function silenceLimitFor(periodMs: number): number {
  return Math.max(10000, periodMs * 4);
}

export class SignalKProvider implements NavigationDataProvider {
  readonly id = "signalk";
  readonly name = "Signal K";

  private listeners: NavigationDataCallback[] = [];
  private ws: WebSocket | null = null;
  private url: string;
  private periodMs = 1000;
  private hasPosition = false;
  private readonly core: ReconnectingTransport;
  private readonly onNotice?: (notice: ProviderNotice) => void;

  // Accumulated state from partial updates
  private latitude = 0;
  private longitude = 0;
  private cog: number | null = null;
  private sog: number | null = null;
  private heading: number | null = null;

  constructor(
    url = "ws://localhost:3000/signalk/v1/stream?subscribe=none",
    onNotice?: (notice: ProviderNotice) => void,
  ) {
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

  isConnected(): boolean {
    return this.core.isConnected();
  }

  isReconnecting(): boolean {
    return this.core.isReconnecting();
  }

  connect(): void {
    if (!this.core.noteConnectRequested()) return;
    void this.startConnect();
  }

  disconnect(): void {
    this.core.noteDisconnectRequested();
    this.teardownSocket();
  }

  /** Manual reconnect (UI button): drop the current socket and retry now. */
  async reconnect(): Promise<void> {
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

  setUrl(url: string): void {
    if (url === this.url) return;
    this.url = url;
    if (!this.core.wantConnected) return;
    // Move the connection to the new server: drop the old socket quietly and
    // retry immediately (the stale socket's close event is ignored by the
    // this.ws identity guard).
    this.teardownSocket();
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
    return new Promise((resolve, reject) => {
      const sock = new WebSocket(this.url);
      this.ws = sock;
      sock.onopen = () => {
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
      };
      sock.onclose = () => {
        // Identity guard: a torn-down socket's close event must not clobber
        // the replacement link's state (the close-race bug).
        if (this.ws !== sock) return;
        this.ws = null;
        reject(new Error("connection closed")); // no-op if already open
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
    connectionLog.log(this.id, "connected", this.url);
    this.onNotice?.({ kind: "connected" });
  }

  // Close whatever socket is current, quietly: nulling this.ws first makes
  // the identity guard swallow the resulting close event.
  private teardownSocket(): void {
    const sock = this.ws;
    this.ws = null;
    sock?.close();
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
        ],
      }),
    );
  }

  private handleMessage(msg: Record<string, unknown>): void {
    const updates = msg.updates as
      | Array<{ values?: Array<{ path: string; value: unknown }> }>
      | undefined;
    if (!updates) return;

    let changed = false;

    for (const update of updates) {
      for (const { path, value } of update.values ?? []) {
        switch (path) {
          case "navigation.position": {
            const pos = value as { latitude: number; longitude: number };
            this.latitude = pos.latitude;
            this.longitude = pos.longitude;
            this.hasPosition = true;
            changed = true;
            break;
          }
          case "navigation.courseOverGroundTrue":
            this.cog = toDegrees(value as number);
            changed = true;
            break;
          case "navigation.speedOverGround":
            this.sog = (value as number) * MS_TO_KNOTS;
            changed = true;
            break;
          case "navigation.headingTrue":
            this.heading = toDegrees(value as number);
            changed = true;
            break;
        }
      }
    }

    if (changed && this.hasPosition) {
      const data: NavigationData = {
        latitude: this.latitude,
        longitude: this.longitude,
        cog: this.cog,
        sog: this.sog,
        heading: this.heading,
        accuracy: null,
        timestamp: Date.now(),
        source: "signalk",
      };

      for (const fn of this.listeners) {
        fn(data);
      }
    }
  }
}
