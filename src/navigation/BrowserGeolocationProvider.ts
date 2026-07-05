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

export class BrowserGeolocationProvider implements NavigationDataProvider {
  readonly id = "browser-gps";
  readonly name = "Browser GPS";

  private listeners: NavigationDataCallback[] = [];
  private watchId: number | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
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
  }

  private stopWatch(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
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

  private onPosition(pos: GeolocationPosition): void {
    const { latitude, longitude, accuracy, heading, speed } = pos.coords;

    const data: NavigationData = {
      latitude,
      longitude,
      cog: heading !== null && !Number.isNaN(heading) ? heading : null,
      sog: speed !== null && !Number.isNaN(speed) ? speed * MS_TO_KNOTS : null,
      heading: null, // browser geolocation doesn't provide true heading
      accuracy: accuracy ?? null,
      timestamp: pos.timestamp,
      source: "browser-gps",
    };

    for (const fn of this.listeners) {
      fn(data);
    }
  }
}
