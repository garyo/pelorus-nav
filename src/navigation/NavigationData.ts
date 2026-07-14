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

/** One satellite's live signal info, from NMEA GSV (+ GSA for `used`). */
export interface SatelliteInfo {
  /** Satellite ID — PRN / slot number within its constellation. */
  prn: number;
  /** Elevation above the horizon in degrees (0-90), or null. */
  elevation: number | null;
  /** Azimuth in degrees true (0-359), or null. */
  azimuth: number | null;
  /** Carrier-to-noise density (C/N0) in dB-Hz, or null if not tracked. */
  snr: number | null;
  /** Constellation name (GPS, GLONASS, Galileo, BeiDou, …). */
  constellation: string;
  /** True if this satellite is used in the current fix solution (from GSA). */
  used: boolean;
}

/** Live receiver/satellite diagnostics, assembled from GSV + GSA sentences. */
export interface SatelliteStatus {
  /** Every satellite in view, across all constellations. */
  satellites: SatelliteInfo[];
  /** Count of satellites in view. */
  inView: number;
  /** Count of satellites used in the fix solution. */
  used: number;
  /** Fix type: 1 = no fix, 2 = 2D, 3 = 3D (from GSA). */
  fixType: number;
  /** Position / horizontal / vertical dilution of precision, or null. */
  pdop: number | null;
  hdop: number | null;
  vdop: number | null;
  /** When this snapshot was assembled (ms since epoch). */
  timestamp: number;
}

export type SatelliteStatusCallback = (status: SatelliteStatus) => void;

/**
 * Optional provider capability: live satellite diagnostics on request. A GPS
 * pod that can stream GSV/GSA (currently the BLE NUS pod) implements this so the
 * UI can show signal bars / fix quality, while keeping that chatty traffic off
 * the wire whenever the diagnostics view is closed.
 */
export interface SatelliteDiagnostics {
  /** Ask the device to start (true) or stop (false) sending GSV/GSA. */
  requestSatelliteData(enable: boolean): void;
  subscribeSatelliteStatus(callback: SatelliteStatusCallback): void;
  unsubscribeSatelliteStatus(callback: SatelliteStatusCallback): void;
}

export function hasSatelliteDiagnostics(
  provider: NavigationDataProvider,
): provider is NavigationDataProvider & SatelliteDiagnostics {
  return (
    typeof (provider as Partial<SatelliteDiagnostics>).requestSatelliteData ===
    "function"
  );
}

export interface NavigationDataProvider {
  /** Unique identifier */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /**
   * True when fixes arrive from external hardware (a BLE/NMEA/Signal K pod), so
   * the device spends no power producing them — the display can update as fast
   * as data arrives. Internal GPS (phone geolocation) leaves this false/unset so
   * the adaptive rate stays battery-conservative.
   */
  readonly external?: boolean;
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
  /**
   * Optional: wall-clock ms of the last raw transport data received (0 =
   * never), regardless of whether it parsed to a fix. Lets the UI separate
   * "connected but silent" (NO DATA — check the device) from "delivering but
   * fixless" (NO FIX — wait for satellites).
   */
  lastRawDataMs?(): number;
  /**
   * Optional: ask the device for its own status ("DIAG" over the NUS RX
   * characteristic; the GPS pod answers with one $PPELD sentence carrying
   * uptime/connection/notify/UART counters). Resolves the raw sentence, or
   * null when the link is down or the device doesn't answer in time. Used by
   * the diagnostics collector so bug reports include the device's view.
   */
  requestDeviceDiag?(timeoutMs?: number): Promise<string | null>;
}
