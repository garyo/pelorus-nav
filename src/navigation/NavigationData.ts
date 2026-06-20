/**
 * Core types for GPS/navigation data and provider interface.
 */

export interface NavigationData {
  /** Latitude in decimal degrees */
  latitude: number;
  /** Longitude in decimal degrees */
  longitude: number;
  /** Course over ground in degrees true (0-360), or null if stationary */
  cog: number | null;
  /** Speed over ground in knots, or null if unavailable */
  sog: number | null;
  /** True heading in degrees (0-360), or null if unavailable */
  heading: number | null;
  /** Horizontal accuracy in meters, or null if unavailable */
  accuracy: number | null;
  /** Timestamp of the fix */
  timestamp: number;
  /** Source identifier */
  source: string;
}

export type NavigationDataCallback = (data: NavigationData) => void;

export interface NavigationDataProvider {
  /** Unique identifier */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Whether the provider is currently connected/active */
  isConnected(): boolean;
  /** Optional: whether the provider is mid-(re)connect (for a "trying" UI state). */
  isReconnecting?(): boolean;
  /** Start providing data */
  connect(): void;
  /** Stop providing data */
  disconnect(): void;
  /**
   * Optional: force an immediate (re)connect attempt — a manual UI trigger for
   * transports that can drop and don't always self-heal (e.g. BLE). Reuses the
   * already-chosen device where possible, so no device picker.
   */
  reconnect?(): void;
  /** Subscribe to navigation data updates */
  subscribe(callback: NavigationDataCallback): void;
  /** Unsubscribe from updates */
  unsubscribe(callback: NavigationDataCallback): void;
  /** Optional: hint the desired update interval (for battery savings). */
  setDesiredIntervalMs?(ms: number): void;
}
