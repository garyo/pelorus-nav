/**
 * Cloudflare Worker entry point.
 * Serves the landing page at "/", the app at /app (via the assets binding's
 * SPA fallback), nautical PMTiles from R2 with HTTP Range support, and the
 * newsletter signup at POST /api/subscribe. Everything else comes from
 * static assets.
 */

interface Env {
  ASSETS: Fetcher;
  TILES: R2Bucket;
  SUBSCRIBERS: KVNamespace;
  /** Bearer token for the read-only admin API (`wrangler secret put ADMIN_TOKEN`). */
  ADMIN_TOKEN?: string;
  /** ntfy endpoint incl. topic, e.g. https://ntfy.example.com/pelorus-signups. */
  NTFY_URL?: string;
  /** HTTP basic-auth token (base64 user:pass) for the ntfy server. */
  NTFY_TOKEN?: string;
}

const ALLOWED_ORIGINS = [
  "https://pelorus-nav.com",
  "https://pelorus-nav.pages.dev",
  "https://localhost", // Capacitor Android WebView
  "capacitor://localhost", // Capacitor iOS WKWebView
  "http://localhost",
  "http://127.0.0.1",
];

function getAllowedOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  if (
    ALLOWED_ORIGINS.some(
      (allowed) => origin === allowed || origin.startsWith(`${allowed}:`),
    )
  ) {
    return origin;
  }
  return null;
}

function parseRange(
  rangeHeader: string,
): { offset: number; length: number } | null {
  // Parse "bytes=START-END"
  const match = rangeHeader.match(/^bytes=(\d+)-(\d+)?$/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] !== undefined ? Number(match[2]) : undefined;
  if (end !== undefined) {
    return { offset: start, length: end - start + 1 };
  }
  return { offset: start, length: 0 }; // 0 = to end of file
}

function contentTypeForKey(key: string): string {
  if (key.endsWith(".geojson")) return "application/geo+json";
  if (key.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

// Cross-origin native clients (https://localhost → pelorus-nav.com) can only
// read CORS-safelisted response headers unless the server explicitly exposes
// more via this header. etag/last-modified drive update detection and the
// `?v=` cache-busting query param, so they must be exposed on every branch
// that serves an R2 object.
const EXPOSED_HEADERS =
  "etag, last-modified, content-length, content-range, accept-ranges";

// PMTiles are huge and stable — cache aggressively.
// Coverage and search metadata are small and get rebuilt on every tile run;
// revalidate quickly when online, but fall back to the last-known copy when
// the client is offline (offshore).
function cacheControlForKey(key: string): string {
  if (key.endsWith(".pmtiles")) {
    return "public, max-age=86400";
  }
  return "public, max-age=300, stale-while-revalidate=2592000, stale-if-error=2592000";
}

async function handleTilesRequest(
  request: Request,
  env: Env,
  key: string,
): Promise<Response> {
  const corsOrigin = getAllowedOrigin(request);
  const corsHeaders: Record<string, string> = corsOrigin
    ? { "access-control-allow-origin": corsOrigin }
    : {};

  const rangeHeader = request.headers.get("range");

  if (rangeHeader) {
    const range = parseRange(rangeHeader);
    if (!range) {
      return new Response("Invalid Range", { status: 416 });
    }

    const options: R2GetOptions = {
      range:
        range.length > 0
          ? { offset: range.offset, length: range.length }
          : { offset: range.offset },
    };

    const object = await env.TILES.get(key, options);
    if (!object) {
      return new Response("Not found", { status: 404 });
    }

    const body = "body" in object ? object.body : null;
    const size = object.size;
    const end = range.length > 0 ? range.offset + range.length - 1 : size - 1;

    return new Response(body, {
      status: 206,
      headers: {
        "content-type": contentTypeForKey(key),
        "content-range": `bytes ${range.offset}-${end}/${size}`,
        "content-length": String(end - range.offset + 1),
        "accept-ranges": "bytes",
        etag: object.httpEtag,
        "last-modified": object.uploaded.toUTCString(),
        "cache-control": cacheControlForKey(key),
        ...corsHeaders,
        "access-control-expose-headers": EXPOSED_HEADERS,
      },
    });
  }

  // Full object request (no Range header) — also covers HEAD, since the
  // Workers runtime strips the body from HEAD responses automatically.
  // `onlyIf` gives conditional-request support: browsers' stale-while-
  // revalidate background revalidation sends If-None-Match, and without a
  // 304 here every revalidation re-downloads the entire body (15-20 MB of
  // search/coverage data per launch on cellular).
  const object = await env.TILES.get(key, { onlyIf: request.headers });
  if (!object) {
    return new Response("Not found", { status: 404 });
  }
  if (!("body" in object) || object.body === null) {
    // Precondition satisfied (If-None-Match matched / not modified) — R2
    // returns a body-less object; answer 304 so the client keeps its copy.
    return new Response(null, {
      status: 304,
      headers: {
        etag: object.httpEtag,
        "last-modified": object.uploaded.toUTCString(),
        "cache-control": cacheControlForKey(key),
        ...corsHeaders,
        "access-control-expose-headers": EXPOSED_HEADERS,
      },
    });
  }
  return new Response(object.body, {
    headers: {
      "content-type": contentTypeForKey(key),
      "content-length": String(object.size),
      "accept-ranges": "bytes",
      etag: object.httpEtag,
      "last-modified": object.uploaded.toUTCString(),
      "cache-control": cacheControlForKey(key),
      ...corsHeaders,
      "access-control-expose-headers": EXPOSED_HEADERS,
    },
  });
}

// Push a signup notification to the (self-hosted) ntfy server. Fire-and-forget
// via ctx.waitUntil — an unreachable ntfy must never delay or fail a signup.
// Skipped entirely when the NTFY_* secrets aren't configured (dev, CI).
function notifySignup(
  env: Env,
  ctx: ExecutionContext,
  record: { email: string; platforms: string[]; note: string; isNew: boolean },
): void {
  if (!env.NTFY_URL || !env.NTFY_TOKEN) return;
  const { email, platforms, note, isNew } = record;
  const body = [
    email,
    `Platforms: ${platforms.join(", ") || "none"}`,
    ...(note ? [`Note: ${note}`] : []),
  ].join("\n");
  ctx.waitUntil(
    fetch(env.NTFY_URL, {
      method: "POST",
      headers: {
        authorization: `Basic ${env.NTFY_TOKEN}`,
        title: isNew ? "New Pelorus signup" : "Signup updated",
        tags: "sailboat,email",
      },
      body,
    })
      .then(async (res) => {
        if (!res.ok) {
          console.error(
            `ntfy notify failed: HTTP ${res.status} ${await res.text()}`,
          );
        }
      })
      .catch((err) => console.error("ntfy notify error:", err)),
  );
}

// Newsletter signup: store one KV entry per address (key = lowercased email,
// so repeat signups are idempotent). Export with
// `wrangler kv key list --namespace-id=<id>`.
async function handleSubscribe(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  let body: {
    email?: string;
    website?: string;
    android?: unknown;
    ios?: unknown;
    note?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  // "website" is the form's honeypot field — bots fill it, humans can't see it
  if (body.website) {
    return Response.json({ ok: true });
  }
  const email = (body.email ?? "").trim();
  if (
    email.length < 6 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
  ) {
    return Response.json({ error: "invalid email" }, { status: 400 });
  }
  // Beta-program interest (checkboxes on the landing form). Repeat signups
  // overwrite the whole record, so the latest platform choices win.
  const platforms = [
    ...(body.android === true ? ["android"] : []),
    ...(body.ios === true ? ["ios"] : []),
  ];
  // Optional free-text note, kept short (the form caps at 200 chars too).
  const note =
    typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";
  const key = email.toLowerCase();
  const isNew = (await env.SUBSCRIBERS.get(key)) === null;
  await env.SUBSCRIBERS.put(
    key,
    JSON.stringify({
      email,
      subscribedAt: new Date().toISOString(),
      source: "landing",
      platforms,
      ...(note ? { note } : {}),
    }),
  );
  notifySignup(env, ctx, { email, platforms, note, isNew });
  return Response.json({ ok: true });
}

// Read-only subscriber dump for the nightly signup-check routine (and manual
// admin use). Requires the ADMIN_TOKEN secret; without it configured the
// endpoint is a hard 401.
async function handleSubscriberList(
  request: Request,
  env: Env,
): Promise<Response> {
  const auth = request.headers.get("authorization");
  if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const records: unknown[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.SUBSCRIBERS.list({ cursor });
    for (const key of page.keys) {
      const value = await env.SUBSCRIBERS.get(key.name);
      if (value) records.push(JSON.parse(value));
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return Response.json(records);
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/subscribers") {
      if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      return handleSubscriberList(request, env);
    }

    if (url.pathname === "/api/subscribe") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      return handleSubscribe(request, env, ctx);
    }

    // The marketing landing page owns the root URL; the app lives at /app
    // (an extensionless path, so the assets binding's SPA fallback serves the
    // app shell there with no further routing here). html_handling is "none"
    // in wrangler.toml, so .html assets resolve at their exact URLs.
    if (url.pathname === "/") {
      return env.ASSETS.fetch(
        new Request(new URL("/landing.html", url), request),
      );
    }

    // Handle CORS preflight for tile/coverage requests
    if (request.method === "OPTIONS") {
      const corsOrigin = getAllowedOrigin(request);
      if (corsOrigin) {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": corsOrigin,
            "access-control-allow-methods": "GET, HEAD, OPTIONS",
            "access-control-allow-headers": "range",
            "access-control-max-age": "86400",
          },
        });
      }
      return new Response(null, { status: 204 });
    }

    // Serve PMTiles, coverage GeoJSON, and search indices from R2
    if (
      url.pathname.endsWith(".pmtiles") ||
      url.pathname.endsWith(".coverage.geojson") ||
      url.pathname.endsWith(".search.json")
    ) {
      const key = url.pathname.slice(1);
      if (key.includes("..") || key.includes("//")) {
        return new Response("Bad Request", { status: 400 });
      }
      return handleTilesRequest(request, env, key);
    }

    const response = await env.ASSETS.fetch(request);

    // The assets binding's SPA fallback returns 200 index.html for ANY
    // missing path. For asset-like paths (anything with a file extension
    // other than .html) that turns a missing file into HTML that clients
    // try to parse as data — e.g. MapLibre glyph PBFs. Return an honest
    // 404 instead; the SPA fallback stays for extensionless app routes.
    const isAssetPath = /\.(?!html?$)[a-z0-9]+$/i.test(url.pathname);
    if (
      isAssetPath &&
      response.headers.get("content-type")?.includes("text/html")
    ) {
      return new Response("Not found", { status: 404 });
    }

    return response;
  },
} satisfies ExportedHandler<Env>;
