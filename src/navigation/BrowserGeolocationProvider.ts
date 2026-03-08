/**
 * GPS provider using the browser Geolocation API.
 * Works on Android/iOS with location permissions.
 */

import type {
  NavigationData,
  NavigationDataCallback,
  NavigationDataProvider,
} from "./NavigationData";

const MS_TO_KNOTS = 1.94384;

export class BrowserGeolocationProvider implements NavigationDataProvider {
  readonly id = "browser-gps";
  readonly name = "Browser GPS";

  private listeners: NavigationDataCallback[] = [];
  private watchId: number | null = null;

  isConnected(): boolean {
    return this.watchId !== null;
  }

  connect(): void {
    if (this.watchId !== null) return;
    if (!("geolocation" in navigator)) {
      console.warn("Geolocation API not available");
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.onPosition(pos),
      (err) => console.warn("Geolocation error:", err.message),
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 10000,
      },
    );
  }

  disconnect(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  subscribe(callback: NavigationDataCallback): void {
    this.listeners.push(callback);
  }

  unsubscribe(callback: NavigationDataCallback): void {
    const idx = this.listeners.indexOf(callback);
    if (idx >= 0) this.listeners.splice(idx, 1);
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
