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
// A host name or IPv4 address, or a bracketed IPv6 address.
const VALID_HOST = /^([a-z\d_-]+(\.[a-z\d_-]+)*|\[[\da-f:.]+\])$/i;

/** The ws:// or wss:// stream URL for `input`, or null if it isn't an address. */
export function signalkStreamUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const scheme = /^([a-z][a-z\d+.-]*):\/\//i.exec(text)?.[1].toLowerCase();
  if (scheme && !["ws", "wss", "http", "https"].includes(scheme)) return null;
  const secure = scheme === "wss" || scheme === "https";
  const rest = scheme ? text.slice(scheme.length + 3) : text;
  // Parsed as http(s), never ws(s): Chrome treats ws as an opaque scheme
  // whose protocol can't be switched from http. Even for http, Chrome
  // percent-encodes a malformed host rather than rejecting it, hence the
  // explicit host check.
  let url: URL;
  try {
    url = new URL(`${secure ? "https" : "http"}://${rest}`);
  } catch {
    return null;
  }
  if (!VALID_HOST.test(url.hostname)) return null;
  const port = url.port || (scheme ? "" : DEFAULT_PORT);
  const path = url.pathname.startsWith("/signalk/")
    ? url.pathname
    : STREAM_PATH;
  url.searchParams.set("subscribe", "none");
  return `${secure ? "wss" : "ws"}://${url.hostname}${port ? `:${port}` : ""}${path}${url.search}`;
}
