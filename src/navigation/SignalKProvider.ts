/**
 * Minimal Signal K provider via WebSocket.
 * Connects to a Signal K server and subscribes to navigation data.
 */

import { toDegrees } from "../utils/coordinates";
import type {
  NavigationData,
  NavigationDataCallback,
  NavigationDataProvider,
} from "./NavigationData";

const MS_TO_KNOTS = 1.94384;

export class SignalKProvider implements NavigationDataProvider {
  readonly id = "signalk";
  readonly name = "Signal K";

  private listeners: NavigationDataCallback[] = [];
  private ws: WebSocket | null = null;
  private url: string;

  // Accumulated state from partial updates
  private latitude = 0;
  private longitude = 0;
  private cog: number | null = null;
  private sog: number | null = null;
  private heading: number | null = null;

  constructor(url = "ws://localhost:3000/signalk/v1/stream?subscribe=none") {
    this.url = url;
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  connect(): void {
    if (this.ws) return;

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      // Subscribe to navigation paths
      this.ws?.send(
        JSON.stringify({
          context: "vessels.self",
          subscribe: [
            { path: "navigation.position", period: 1000 },
            { path: "navigation.courseOverGroundTrue", period: 1000 },
            { path: "navigation.speedOverGround", period: 1000 },
            { path: "navigation.headingTrue", period: 1000 },
          ],
        }),
      );
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        this.handleMessage(msg);
      } catch {
        // ignore parse errors
      }
    };

    this.ws.onerror = () => {
      console.warn("Signal K WebSocket error");
    };

    this.ws.onclose = () => {
      this.ws = null;
    };
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
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
    const wasConnected = this.isConnected();
    this.disconnect();
    this.url = url;
    if (wasConnected) this.connect();
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

    if (changed && this.latitude !== 0) {
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
