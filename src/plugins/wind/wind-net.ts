/**
 * Classify a wind-fetch failure so the UI can tell a *connectivity* problem
 * (airplane mode / no Internet) apart from a *quota* one (HTTP 429 / Open-Meteo
 * error body). They need different handling: a connectivity failure must NOT arm
 * the long rate-limit backoff — barbs should return promptly once the link is
 * back — and the user should be told to get online, not that they're throttled.
 */

/**
 * True when a fetch failure is a connectivity problem rather than a server/quota
 * error. `fetch` rejects with a `TypeError` on network failure ("Failed to
 * fetch" on Chromium, "Load failed" on iOS Safari/WKWebView); `navigator.onLine
 * === false` is a definitive offline signal. Our explicit rate-limit/HTTP
 * throws are plain `Error`s, so they stay classified as quota/server errors.
 */
export function isConnectivityError(err: unknown, online: boolean): boolean {
  return !online || err instanceof TypeError;
}
