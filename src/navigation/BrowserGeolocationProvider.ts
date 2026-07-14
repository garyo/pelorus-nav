/**
 * GPS provider using the browser Geolocation API.
 * Works on Android/iOS with location permissions.
 *
 * Supports adaptive polling: in fast mode uses watchPosition (continuous),
 * in slow/medium mode switches to periodic getCurrentPosition to save battery.
 */

import { MS_TO_KNOTS } from "../utils/units";
import { connectionLog } from "./ConnectionEventLog";
import type {
  NavigationData,
  NavigationDataCallback,
  NavigationDataProvider,
} from "./NavigationData";
import type { ProviderNotice } from "./ProviderNotice";

/**
 * Watch-mode keep-alive period. `watchPosition` only re-fires when the position
 * changes, so a stationary vessel — or desktop WiFi geolocation that never
 * moves — goes silent, which the fix-staleness watchdog misreads as signal loss
 * ("NO FIX"). After this much silence we re-emit the last known fix with a
 * current timestamp so it stays fresh. (We deliberately do NOT poll
 * `getCurrentPosition` here: with the watch quiet its cache is always stale, so
 * every call forces a fresh Core Location lookup that takes seconds or times
 * out on desktop.) A genuine loss makes `watchPosition` *error*, which suppresses
 * the re-emit so real staleness still surfaces. Kept under the ~5 s threshold.
 */
const WATCH_KEEPALIVE_MS = 2000;

export class BrowserGeolocationProvider implements NavigationDataProvider {
  readonly id = "browser-gps";
  readonly name = "Browser GPS";

  private listeners: NavigationDataCallback[] = [];
  private watchId: number | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private keepAliveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPos: GeolocationPosition | null = null;
  private lastFixMs = 0;
  private lastErrorMs = 0;
  private connected = false;
  private desiredIntervalMs = 2000;
  private readonly onNotice?: (notice: ProviderNotice) => void;

  constructor(onNotice?: (notice: ProviderNotice) => void) {
    this.onNotice = onNotice;
  }

  /**
   * PERMISSION_DENIED is terminal: the browser will never deliver a fix and
   * will not re-prompt — polling forever just looks like a healthy provider
   * that never produces data. Stop and tell the user. Transient errors
   * (TIMEOUT, POSITION_UNAVAILABLE) keep the watch/poll running.
   */
  private handleError(err: GeolocationPositionError): void {
    if (err.code === err.PERMISSION_DENIED) {
      connectionLog.log(this.id, "error", "location permission denied");
      this.disconnect();
      this.onNotice?.({
        kind: "connect-failed",
        detail: "location permission denied — enable it in browser settings",
      });
      return;
    }
    // A genuine loss (POSITION_UNAVAILABLE / TIMEOUT) — record it so the
    // keep-alive stops re-emitting the last fix and the HUD goes stale.
    this.lastErrorMs = Date.now();
    console.warn("Geolocation error:", err.message);
  }

  isConnected(): boolean {
    return this.connected;
  }

  connect(): void {
    if (this.connected) return;
    if (!("geolocation" in navigator)) {
      console.warn("Geolocation API not available");
      return;
    }
    this.connected = true;
    this.startWatch();
  }

  disconnect(): void {
    this.connected = false;
    this.stopWatch();
    this.stopPoll();
  }

  /**
   * Manual reconnect (banner Retry): full disconnect + connect. Needed after
   * PERMISSION_DENIED, which stops the watch/poll for good — the user has to
   * re-grant permission in browser settings first, then retry here.
   */
  reconnect(): void {
    this.disconnect();
    this.connect();
  }

  subscribe(callback: NavigationDataCallback): void {
    this.listeners.push(callback);
  }

  unsubscribe(callback: NavigationDataCallback): void {
    const idx = this.listeners.indexOf(callback);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  setDesiredIntervalMs(ms: number): void {
    if (ms === this.desiredIntervalMs) return;
    this.desiredIntervalMs = ms;
    if (!this.connected) return;

    if (ms <= 2000) {
      // Fast mode — use continuous watchPosition
      this.stopPoll();
      if (this.watchId === null) this.startWatch();
    } else {
      // Slow/medium — periodic getCurrentPosition saves GPS battery
      this.stopWatch();
      this.startPoll(ms);
    }
  }

  private startWatch(): void {
    if (this.watchId !== null) return;
    this.stopPoll();
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.onPosition(pos),
      (err) => this.handleError(err),
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 10000,
      },
    );
    this.scheduleKeepAlive();
  }

  private stopWatch(): void {
    this.clearKeepAlive();
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  /**
   * (Re)arm the watch keep-alive: a single timer, reset on every fix, that fires
   * only after WATCH_KEEPALIVE_MS of silence. On firing it re-emits the last
   * known fix with a current timestamp (unless the watch has errored since the
   * last real fix), then re-arms — so while `watchPosition` is delivering
   * (moving) it never fires, and while the watch is quiet (stationary) the fix
   * stays fresh. Watch-mode only; poll mode re-emits on its own timer.
   */
  private scheduleKeepAlive(): void {
    if (this.watchId === null) return;
    this.clearKeepAlive();
    this.keepAliveTimer = setTimeout(() => {
      this.keepAliveTimer = null;
      if (this.lastPos && this.lastFixMs > this.lastErrorMs) {
        this.emit(this.lastPos, Date.now());
      }
      this.scheduleKeepAlive();
    }, WATCH_KEEPALIVE_MS);
  }

  private clearKeepAlive(): void {
    if (this.keepAliveTimer !== null) {
      clearTimeout(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private startPoll(intervalMs: number): void {
    this.stopPoll();
    // Get an immediate fix, then poll at interval
    this.pollOnce(intervalMs);
    this.pollTimer = setInterval(() => this.pollOnce(intervalMs), intervalMs);
  }

  private stopPoll(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private pollOnce(maxAge: number): void {
    navigator.geolocation.getCurrentPosition(
      (pos) => this.onPosition(pos),
      (err) => this.handleError(err),
      {
        enableHighAccuracy: true,
        maximumAge: maxAge,
        timeout: 10000,
      },
    );
  }

  /** A real fix from the watch or poll: remember it and reset the watchdog. */
  private onPosition(pos: GeolocationPosition): void {
    this.lastPos = pos;
    this.lastFixMs = Date.now();
    this.scheduleKeepAlive();
    this.emit(pos, pos.timestamp);
  }

  /** Convert a GeolocationPosition to NavigationData and fan out to listeners.
   *  `timestamp` is passed separately so the keep-alive can re-emit the last
   *  position with a current time (keeping a stationary fix fresh). */
  private emit(pos: GeolocationPosition, timestamp: number): void {
    const { latitude, longitude, accuracy, heading, speed } = pos.coords;

    const data: NavigationData = {
      latitude,
      longitude,
      cog: heading !== null && !Number.isNaN(heading) ? heading : null,
      sog: speed !== null && !Number.isNaN(speed) ? speed * MS_TO_KNOTS : null,
      heading: null, // browser geolocation doesn't provide true heading
      accuracy: accuracy ?? null,
      timestamp,
      source: "browser-gps",
    };

    for (const fn of this.listeners) {
      fn(data);
    }
  }
}
