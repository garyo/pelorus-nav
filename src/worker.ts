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
  ADMIN_META: KVNamespace;
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
  // Bug reports (PII) and CSP violation reports share the R2 bucket with
  // public tiles. Refuse them here explicitly, so a future edit to the
  // route's extension allowlist can never expose them.
  if (key.startsWith(BUG_REPORT_PREFIX) || key.startsWith(CSP_REPORT_PREFIX)) {
    return new Response("Not found", { status: 404 });
  }

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

// Push a notification to the (self-hosted) ntfy server. Fire-and-forget via
// ctx.waitUntil — an unreachable ntfy must never delay or fail the request
// that triggered it. Skipped entirely when the NTFY_* secrets aren't
// configured (dev, CI).
function notifyNtfy(
  env: Env,
  ctx: ExecutionContext,
  msg: { title: string; tags: string; body: string },
): void {
  if (!env.NTFY_URL || !env.NTFY_TOKEN) return;
  ctx.waitUntil(
    fetch(env.NTFY_URL, {
      method: "POST",
      headers: {
        authorization: `Basic ${env.NTFY_TOKEN}`,
        title: msg.title,
        tags: msg.tags,
      },
      body: msg.body,
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

/** Value shape stored in the SUBSCRIBERS KV (key = lowercased email). */
interface SubscriberRecord {
  email: string;
  subscribedAt: string;
  source: string;
  platforms: string[];
  note?: string;
  /** CRM state set via the admin API; absent means "new". */
  status?: string;
  statusUpdatedAt?: string;
}

/** Sanity check for user-supplied addresses (subscribe and bug-report). */
function isValidEmail(email: string): boolean {
  return (
    email.length >= 6 &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
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
  if (!isValidEmail(email)) {
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
  // A re-signup overwrites the record (latest platform choices win), but the
  // CRM fields the admin tool sets must survive the overwrite.
  const existingRaw = await env.SUBSCRIBERS.get(key);
  const existing: SubscriberRecord | null = existingRaw
    ? JSON.parse(existingRaw)
    : null;
  const isNew = existing === null;
  await env.SUBSCRIBERS.put(
    key,
    JSON.stringify({
      email,
      subscribedAt: new Date().toISOString(),
      source: "landing",
      platforms,
      ...(note ? { note } : {}),
      ...(existing?.status ? { status: existing.status } : {}),
      ...(existing?.statusUpdatedAt
        ? { statusUpdatedAt: existing.statusUpdatedAt }
        : {}),
    }),
  );
  notifyNtfy(env, ctx, {
    title: isNew ? "New Pelorus signup" : "Signup updated",
    tags: "sailboat,email",
    body: [
      email,
      `Platforms: ${platforms.join(", ") || "none"}`,
      ...(note ? [`Note: ${note}`] : []),
    ].join("\n"),
  });
  return Response.json({ ok: true });
}

// In-app bug reports: description + optional reply address + the app's full
// diagnostics dump, plus an optional chart screenshot (JPEG data URL). The
// text is stored whole in R2 under bug-reports/ with the screenshot as a
// sibling .jpg (same base name) — the tile-serving route only exposes
// *.pmtiles/*.coverage.geojson/*.search.json and additionally rejects any
// bug-reports/ key outright, so reports are unreachable from outside. Read
// with:
//   wrangler r2 object get pelorus-nav bug-reports/<name> --remote
const BUG_REPORT_MAX_BYTES = 1_000_000;
const SCREENSHOT_DATA_URL_PREFIX = "data:image/jpeg;base64,";
const SCREENSHOT_MAX_BYTES = 2_000_000;

/** Decode a JPEG data URL to bytes; null if malformed or oversized. */
function decodeScreenshot(value: unknown): Uint8Array | null {
  if (
    typeof value !== "string" ||
    !value.startsWith(SCREENSHOT_DATA_URL_PREFIX) ||
    value.length > SCREENSHOT_MAX_BYTES
  ) {
    return null;
  }
  try {
    const b64 = value.slice(SCREENSHOT_DATA_URL_PREFIX.length);
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Read a request body as text, capping the bytes actually buffered. Returns
 * null once the cap is passed (the read stops there — a content-length lie
 * or chunked encoding can't make us buffer an unbounded body).
 */
async function readBodyCapped(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buffer);
}

async function handleBugReport(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // The native app posts cross-origin (https://localhost → pelorus-nav.com),
  // so real responses need the CORS origin echoed just like the tile routes.
  const corsOrigin = getAllowedOrigin(request);
  const corsHeaders: Record<string, string> = corsOrigin
    ? { "access-control-allow-origin": corsOrigin }
    : {};
  const jsonResponse = (data: unknown, status = 200) =>
    Response.json(data, { status, headers: corsHeaders });

  // Size cap enforced on the stream itself — a content-length header check
  // alone would miss chunked bodies, which carry no content-length at all.
  const maxRequestBytes = BUG_REPORT_MAX_BYTES + SCREENSHOT_MAX_BYTES;
  const rawBody = await readBodyCapped(request, maxRequestBytes);
  if (rawBody === null) return jsonResponse({ error: "report too large" }, 413);
  let body: {
    description?: unknown;
    email?: unknown;
    diagnostics?: unknown;
    screenshot?: unknown;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "invalid JSON" }, 400);
  }
  const description =
    typeof body.description === "string"
      ? body.description.trim().slice(0, 2000)
      : "";
  if (!description) return jsonResponse({ error: "description required" }, 400);
  const rawEmail = typeof body.email === "string" ? body.email.trim() : "";
  // Invalid reply addresses degrade to "(none)" rather than rejecting the
  // report — the description and diagnostics are the payload that matters.
  const email = isValidEmail(rawEmail) ? rawEmail : "";
  const diagnostics =
    typeof body.diagnostics === "string"
      ? body.diagnostics.slice(0, BUG_REPORT_MAX_BYTES)
      : "";

  const screenshot = decodeScreenshot(body.screenshot);

  const now = new Date();
  const base = `bug-reports/${now.toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  const key = `${base}.txt`;
  const text = [
    `date: ${now.toISOString()}`,
    `email: ${email || "(none)"}`,
    `screenshot: ${screenshot ? `${base}.jpg` : "(none)"}`,
    "",
    "--- DESCRIPTION ---",
    description,
    "",
    "--- DIAGNOSTICS ---",
    diagnostics || "(none)",
    "",
  ].join("\n");
  await env.TILES.put(key, text, {
    httpMetadata: { contentType: "text/plain" },
  });
  if (screenshot) {
    await env.TILES.put(`${base}.jpg`, screenshot, {
      httpMetadata: { contentType: "image/jpeg" },
    });
  }

  notifyNtfy(env, ctx, {
    title: "Pelorus bug report",
    tags: "bug",
    body: [
      description.slice(0, 300) + (description.length > 300 ? "…" : ""),
      ...(email ? [`From: ${email}`] : []),
      `r2: ${key}`,
    ].join("\n"),
  });
  return jsonResponse({ ok: true });
}

// CSP violation reports (see CSP_REPORT_ONLY_* below): stored in R2 under
// csp-reports/ as one compact JSON record per (day, directive, blocked URI).
// The key is derived from the violation itself, so a noisy client overwrites
// the same object instead of flooding the bucket. Review during the soak via
// GET /api/admin/csp-reports.
const CSP_REPORT_MAX_BYTES = 16_384;
const CSP_REPORT_PREFIX = "csp-reports/";
/** Longest value kept for any single field of a stored CSP report. */
const CSP_FIELD_MAX_CHARS = 500;

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function cspField(value: unknown): string {
  return typeof value === "string" ? value.slice(0, CSP_FIELD_MAX_CHARS) : "";
}

/**
 * Accept a browser CSP violation report. Browsers POST two formats depending
 * on delivery mechanism: `application/csp-report` (report-uri; body is
 * {"csp-report": {kebab-case fields}}) and `application/reports+json`
 * (Reporting API; body is an array of {type, body: {camelCase fields}}).
 * Only report-uri is wired into the policy today, but both parse here.
 */
async function handleCspReport(request: Request, env: Env): Promise<Response> {
  const rawBody = await readBodyCapped(request, CSP_REPORT_MAX_BYTES);
  if (rawBody === null) {
    return new Response("Payload Too Large", { status: 413 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  // Normalize either format down to one report object with kebab/camel keys.
  const report: Record<string, unknown> | null = (() => {
    if (Array.isArray(parsed)) {
      const first = parsed[0];
      if (first && typeof first === "object" && "body" in first) {
        const body = (first as { body?: unknown }).body;
        if (body && typeof body === "object") {
          return body as Record<string, unknown>;
        }
      }
      return null;
    }
    if (parsed && typeof parsed === "object") {
      const wrapped = (parsed as { "csp-report"?: unknown })["csp-report"];
      if (wrapped && typeof wrapped === "object") {
        return wrapped as Record<string, unknown>;
      }
    }
    return null;
  })();
  if (!report) {
    return new Response("Bad Request", { status: 400 });
  }
  const directive =
    cspField(report["effective-directive"]) ||
    cspField(report["violated-directive"]) ||
    cspField(report.effectiveDirective);
  if (!directive) {
    return new Response("Bad Request", { status: 400 });
  }
  const blockedUri =
    cspField(report["blocked-uri"]) || cspField(report.blockedURL);
  const record = {
    receivedAt: new Date().toISOString(),
    directive,
    blockedUri,
    documentUri:
      cspField(report["document-uri"]) || cspField(report.documentURL),
    sourceFile: cspField(report["source-file"]) || cspField(report.sourceFile),
    userAgent: cspField(request.headers.get("user-agent")),
  };
  const day = record.receivedAt.slice(0, 10);
  const hash = (await sha256Hex(`${directive}\n${blockedUri}`)).slice(0, 16);
  await env.TILES.put(
    `${CSP_REPORT_PREFIX}${day}/${hash}.json`,
    JSON.stringify(record),
    { httpMetadata: { contentType: "application/json" } },
  );
  return new Response(null, { status: 204 });
}

// Read-only subscriber dump for the nightly signup-check routine (and manual
// admin use). Requires the ADMIN_TOKEN secret; without it configured the
// endpoint is a hard 401.
async function handleSubscriberList(
  request: Request,
  env: Env,
): Promise<Response> {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
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

// ---------------------------------------------------------------------------
// Admin API (/api/admin/*): browse and triage bug reports and signups.
// Consumed by the tools/admin/ TUI, not by browsers — so no CORS headers.
// Bug triage statuses live in the ADMIN_META KV keyed by the report's R2
// object key; an absent key means "new". Subscriber statuses live inside the
// subscriber record itself (see SubscriberRecord).
// ---------------------------------------------------------------------------

const BUG_STATUSES = ["new", "ack", "in-progress", "fixed", "wontfix", "spam"];
const SUBSCRIBER_STATUSES = ["new", "contacted", "beta", "unsubscribed"];
const BUG_REPORT_PREFIX = "bug-reports/";

/**
 * Bearer-token gate for admin routes; null means authorized. Fails closed
 * when ADMIN_TOKEN is unset. The comparison hashes both sides and uses
 * timingSafeEqual, so response timing leaks nothing about the token.
 */
async function requireAdmin(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const auth = request.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ")
    ? auth.slice("Bearer ".length)
    : "";
  if (!env.ADMIN_TOKEN || !provided) {
    return new Response("Unauthorized", { status: 401 });
  }
  const encoder = new TextEncoder();
  const [expected, presented] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(env.ADMIN_TOKEN)),
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
  ]);
  if (!crypto.subtle.timingSafeEqual(expected, presented)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

/** The only user input that reaches R2 from the admin API. */
function isValidBugKey(key: string, ext = ".txt"): boolean {
  return (
    key.startsWith(BUG_REPORT_PREFIX) &&
    key.endsWith(ext) &&
    !key.includes("..") &&
    !key.includes("//")
  );
}

// List bug reports: R2 listing (key/size/uploaded) merged with triage
// statuses from ADMIN_META. Bodies are not read here — they're immutable, so
// the TUI fetches each once via /api/admin/bug and caches it on disk.
async function handleAdminBugList(env: Env): Promise<Response> {
  const statuses = new Map<string, { status: string; updatedAt: string }>();
  let kvCursor: string | undefined;
  do {
    const page = await env.ADMIN_META.list({
      prefix: BUG_REPORT_PREFIX,
      cursor: kvCursor,
    });
    for (const key of page.keys) {
      const value = await env.ADMIN_META.get(key.name);
      if (value) statuses.set(key.name, JSON.parse(value));
    }
    kvCursor = page.list_complete ? undefined : page.cursor;
  } while (kvCursor);

  // One report can be two objects: the .txt body and an optional .jpg chart
  // screenshot with the same base name. Only .txt objects become bug rows.
  const reports: R2Object[] = [];
  const screenshots = new Set<string>();
  let r2Cursor: string | undefined;
  do {
    const page = await env.TILES.list({
      prefix: BUG_REPORT_PREFIX,
      cursor: r2Cursor,
    });
    for (const object of page.objects) {
      if (object.key.endsWith(".jpg")) screenshots.add(object.key);
      else reports.push(object);
    }
    r2Cursor = page.truncated ? page.cursor : undefined;
  } while (r2Cursor);

  const bugs = reports.map((object) => {
    const meta = statuses.get(object.key);
    const screenshotKey = object.key.replace(/\.txt$/, ".jpg");
    return {
      key: object.key,
      size: object.size,
      uploaded: object.uploaded.toISOString(),
      status: meta?.status ?? "new",
      statusUpdatedAt: meta?.updatedAt ?? null,
      screenshotKey: screenshots.has(screenshotKey) ? screenshotKey : null,
    };
  });

  return Response.json({ bugs });
}

async function handleAdminBugGet(env: Env, url: URL): Promise<Response> {
  const key = url.searchParams.get("key") ?? "";
  if (!isValidBugKey(key)) {
    return new Response("Bad Request", { status: 400 });
  }
  const object = await env.TILES.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

async function handleAdminBugScreenshot(env: Env, url: URL): Promise<Response> {
  const key = url.searchParams.get("key") ?? "";
  if (!isValidBugKey(key, ".jpg")) {
    return new Response("Bad Request", { status: 400 });
  }
  const object = await env.TILES.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: { "content-type": "image/jpeg" },
  });
}

async function handleAdminBugStatus(
  request: Request,
  env: Env,
): Promise<Response> {
  let body: { key?: unknown; status?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const key = typeof body.key === "string" ? body.key : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!isValidBugKey(key) || !BUG_STATUSES.includes(status)) {
    return Response.json({ error: "invalid key or status" }, { status: 400 });
  }
  const updatedAt = new Date().toISOString();
  await env.ADMIN_META.put(key, JSON.stringify({ status, updatedAt }));
  return Response.json({ ok: true, status, updatedAt });
}

async function handleAdminSubscriberStatus(
  request: Request,
  env: Env,
): Promise<Response> {
  let body: { email?: unknown; status?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!email || !SUBSCRIBER_STATUSES.includes(status)) {
    return Response.json({ error: "invalid email or status" }, { status: 400 });
  }
  const key = email.toLowerCase();
  const raw = await env.SUBSCRIBERS.get(key);
  if (!raw) return new Response("Not found", { status: 404 });
  const record: SubscriberRecord = JSON.parse(raw);
  record.status = status;
  record.statusUpdatedAt = new Date().toISOString();
  await env.SUBSCRIBERS.put(key, JSON.stringify(record));
  return Response.json(record);
}

// List stored CSP violation reports, newest day first. One record per
// (day, directive, blocked URI) — see handleCspReport — so the whole listing
// stays small enough to read in one response during the report-only soak.
async function handleAdminCspReports(env: Env): Promise<Response> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.TILES.list({
      prefix: CSP_REPORT_PREFIX,
      cursor,
    });
    for (const object of page.objects) keys.push(object.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  keys.sort().reverse();

  const reports: unknown[] = [];
  for (const key of keys) {
    const object = await env.TILES.get(key);
    if (!object) continue;
    reports.push({ key, ...(await object.json<Record<string, unknown>>()) });
  }
  return Response.json({ reports });
}

async function handleAdminRequest(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const route = `${request.method} ${url.pathname}`;
  switch (route) {
    case "GET /api/admin/bugs":
      return handleAdminBugList(env);
    case "GET /api/admin/csp-reports":
      return handleAdminCspReports(env);
    case "GET /api/admin/bug":
      return handleAdminBugGet(env, url);
    case "GET /api/admin/bug-screenshot":
      return handleAdminBugScreenshot(env, url);
    case "PUT /api/admin/bug-status":
      return handleAdminBugStatus(request, env);
    case "PUT /api/admin/subscriber-status":
      return handleAdminSubscriberStatus(request, env);
    default:
      return new Response("Not found", { status: 404 });
  }
}

// Hardening headers for the HTML pages the worker serves.
// X-Frame-Options is safe — nothing embeds these pages in a frame (the
// landing page's only iframe points outward, at YouTube).
const HTML_SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-frame-options": "DENY",
};

// Content-Security-Policy, currently REPORT-ONLY: violations POST to
// /api/csp-report (reviewed via /api/admin/csp-reports) without blocking
// anything, to soak-test the policy before enforcing it. Two policies,
// because the app talks to the network in ways the static site pages never
// do. Shared choices:
//   - script-src has no 'unsafe-inline': the inline bootstrap scripts in
//     index.html / landing.html / VitePress <head> DO violate it, and each
//     dedupes to a single stored "inline" record per day. Enforcing later
//     means adding hashes or extracting those scripts to files.
//   - style-src needs 'unsafe-inline': the pages carry <style> blocks and
//     MapLibre injects a <style> element at runtime.
//   - analytics.oberbrunner.com is the featherstat tracker (dynamic import
//     → script-src; its /api/collect beacon → connect-src).
const CSP_COMMON =
  "object-src 'none'; base-uri 'self'; form-action 'self'; " +
  "report-uri /api/csp-report";

// App shell (/app). connect-src must stay '*':
// Signal K servers are arbitrary user-configured LAN hosts (http/ws, any
// address). The enumerable rest — same-origin R2 tiles via pelorus-nav.com,
// tile.openstreetmap.org, tile.openweathermap.org (weather overlay),
// api.open-meteo.com (wind overlay), gis.charttools.noaa.gov (WMS charts),
// analytics.oberbrunner.com — would fit an allowlist, but Signal K can't.
// worker-src: MapLibre builds its worker from a blob: URL; the app's OPFS
// writer worker and the service worker are same-origin files.
const APP_CSP_REPORT_ONLY =
  "default-src 'self'; " +
  "script-src 'self' https://analytics.oberbrunner.com; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; " +
  "worker-src 'self' blob:; " +
  "connect-src *; " +
  "frame-src 'none'; " +
  CSP_COMMON;

// Static site pages (landing, privacy, user guide): only same-origin fetches
// (the /api/subscribe form post, VitePress page loads) plus the analytics
// beacon; the only frame is the landing page's click-to-load YouTube embed
// (landing.html uses the -nocookie host).
const SITE_CSP_REPORT_ONLY =
  "default-src 'self'; " +
  "script-src 'self' https://analytics.oberbrunner.com; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; " +
  "connect-src 'self' https://analytics.oberbrunner.com; " +
  "frame-src https://www.youtube-nocookie.com; " +
  CSP_COMMON;

/** Copy of `response` with the HTML hardening headers and the page's CSP. */
function withSecurityHeaders(response: Response, csp: string): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(HTML_SECURITY_HEADERS)) {
    secured.headers.set(name, value);
  }
  secured.headers.set("content-security-policy-report-only", csp);
  return secured;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight, for both tile Range requests and the JSON API posts
    // from the native app's cross-site origin. Must precede the route
    // handlers — their method checks would 405 an OPTIONS request.
    if (request.method === "OPTIONS") {
      const corsOrigin = getAllowedOrigin(request);
      if (corsOrigin) {
        const isApi = url.pathname.startsWith("/api/");
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": corsOrigin,
            "access-control-allow-methods": isApi
              ? "POST, OPTIONS"
              : "GET, HEAD, OPTIONS",
            "access-control-allow-headers": isApi ? "content-type" : "range",
            "access-control-max-age": "86400",
          },
        });
      }
      return new Response(null, { status: 204 });
    }

    if (url.pathname.startsWith("/api/admin/")) {
      return handleAdminRequest(request, env, url);
    }

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

    if (url.pathname === "/api/bug-report") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      return handleBugReport(request, env, ctx);
    }

    if (url.pathname === "/api/csp-report") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      return handleCspReport(request, env);
    }

    // The marketing landing page owns the root URL; the app lives at /app
    // (an extensionless path, so the assets binding's SPA fallback serves the
    // app shell there with no further routing here). html_handling is "none"
    // in wrangler.toml, so .html assets resolve at their exact URLs.
    if (url.pathname === "/") {
      return withSecurityHeaders(
        await env.ASSETS.fetch(
          new Request(new URL("/landing.html", url), request),
        ),
        SITE_CSP_REPORT_ONLY,
      );
    }

    // Online user guide (VitePress, built into dist/doc/userguide by
    // `bun run build`). html_handling is "none", so directory URLs must be
    // rewritten to their index.html here; VitePress page links carry .html
    // extensions and resolve as plain assets.
    if (url.pathname === "/doc" || url.pathname === "/doc/") {
      return Response.redirect(new URL("/doc/userguide/", url).toString(), 302);
    }
    if (/^\/doc\//.test(url.pathname) && !/\.[a-z0-9]+$/i.test(url.pathname)) {
      const dir = url.pathname.replace(/\/$/, "");
      return withSecurityHeaders(
        await env.ASSETS.fetch(
          new Request(new URL(`${dir}/index.html`, url), request),
        ),
        SITE_CSP_REPORT_ONLY,
      );
    }

    // Privacy policy at a clean URL (required by Play Store / App Store).
    if (url.pathname === "/privacy") {
      return withSecurityHeaders(
        await env.ASSETS.fetch(
          new Request(new URL("/privacy.html", url), request),
        ),
        SITE_CSP_REPORT_ONLY,
      );
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

    // Same honesty for extensionless paths outside /app. The app shell
    // belongs at /app only — matching the service worker's navigation
    // allowlist — and future site sections (/docs, /help, …) get explicit
    // routes above, so an unrouted path is a real 404, not a surprise
    // copy of the app.
    const isAppPath = /^\/app(?:\/|$)/.test(url.pathname);
    const isExtensionless = !/\.[a-z0-9]+$/i.test(url.pathname);
    if (
      !isAppPath &&
      isExtensionless &&
      response.headers.get("content-type")?.includes("text/html")
    ) {
      return new Response("Not found", { status: 404 });
    }

    // Hardening headers on any HTML the assets binding serves (the /app
    // shell via SPA fallback, guide pages, landing assets fetched by exact
    // URL). The app shell gets the app CSP; every other page is static site
    // content. Non-HTML assets pass through untouched.
    if (response.headers.get("content-type")?.includes("text/html")) {
      return withSecurityHeaders(
        response,
        isAppPath ? APP_CSP_REPORT_ONLY : SITE_CSP_REPORT_ONLY,
      );
    }

    return response;
  },
} satisfies ExportedHandler<Env>;
