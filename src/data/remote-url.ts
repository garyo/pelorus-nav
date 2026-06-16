/**
 * Provides the correct base URL for chart/tile assets.
 *
 * In Capacitor with a dev server (CAP_DEV_SERVER), the origin is already the
 * Vite server which supports Range requests — so same-origin ("") works.
 *
 * In Capacitor with bundled assets (no dev server), the chart assets (PMTiles,
 * coverage GeoJSON, search indices) aren't in the bundle and the local origin
 * doesn't support Range requests, so we stream from the production Cloudflare
 * R2 server.
 *
 * In a regular browser, same-origin ("") works because the Cloudflare Worker
 * or Vite dev server handles Range requests.
 */
import { Capacitor } from "@capacitor/core";

const REMOTE_TILE_ORIGIN = "https://pelorus-nav.com";

/** True when running inside a Capacitor native shell. */
export const isNative: boolean = Capacitor.isNativePlatform();

/**
 * Base URL prefix for chart asset URLs.
 * Empty string = same-origin (works for browser and Capacitor dev server).
 * Full URL = production server (for Capacitor bundled builds).
 */
export function chartAssetBase(): string {
  if (!isNative) return "";
  // A CAP_DEV_SERVER dev server is loaded over http(s) from a real host/port
  // (a LAN IP, or localhost with a port) and supports Range — same-origin works.
  // The bundled builds load from a scheme-based localhost origin with no port
  // (https://localhost on Android, capacitor://localhost on iOS); checking for
  // an explicit port / non-localhost host catches the dev server on both
  // schemes without depending on the native platform's scheme.
  const isDevServer =
    (location.protocol === "http:" || location.protocol === "https:") &&
    (location.hostname !== "localhost" || location.port !== "");
  if (isDevServer) return "";
  // Bundled native build → assets aren't in the bundle; stream from remote.
  return REMOTE_TILE_ORIGIN;
}
