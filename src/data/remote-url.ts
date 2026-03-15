/**
 * Provides the correct base URL for chart/tile assets.
 *
 * In Capacitor with a dev server (CAP_DEV_SERVER), the origin is already the
 * Vite server which supports Range requests — so same-origin ("") works.
 *
 * In Capacitor with bundled assets (no dev server), localhost doesn't support
 * Range requests, so we stream from the production Cloudflare R2 server.
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
  // If loaded from a dev server, the origin already supports Range requests
  if (
    location.hostname !== "localhost" ||
    location.protocol !== "https:" ||
    location.port !== ""
  ) {
    return "";
  }
  // Bundled Capacitor build (https://localhost with no port) → use remote
  return REMOTE_TILE_ORIGIN;
}
