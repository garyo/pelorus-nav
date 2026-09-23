/**
 * Turn what a user types for their Signal K server into its stream URL.
 *
 * People know an address ("192.168.1.50", "openplotter.local:3000") or copy
 * the server's admin page URL ("http://192.168.1.50:3000/admin/"); a full
 * ws:// stream URL passes through too. A bare address gets Signal K's default
 * port; an explicit scheme keeps whatever port it names (or its standard one).
 * The query always carries subscribe=none — the provider subscribes to exactly
 * the paths it needs rather than taking the server's default firehose.
 */

const DEFAULT_PORT = "3000";
const STREAM_PATH = "/signalk/v1/stream";

/** The ws:// or wss:// stream URL for `input`, or null if it isn't an address. */
export function signalkStreamUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(text);
  let url: URL;
  try {
    url = new URL(hasScheme ? text : `ws://${text}`);
  } catch {
    return null;
  }
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
  if (!url.hostname) return null;
  if (!hasScheme && !url.port) url.port = DEFAULT_PORT;
  if (!url.pathname.startsWith("/signalk/")) url.pathname = STREAM_PATH;
  url.hash = "";
  url.searchParams.set("subscribe", "none");
  return url.toString();
}
