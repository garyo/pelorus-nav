/**
 * Cloudflare Worker entry point.
 * Serves nautical.pmtiles from R2 with HTTP Range support; everything else from static assets.
 */

interface Env {
  ASSETS: Fetcher;
  TILES: R2Bucket;
}

const ALLOWED_ORIGINS = [
  "https://pelorus-nav.pages.dev",
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
        "content-type": "application/octet-stream",
        "content-range": `bytes ${range.offset}-${end}/${size}`,
        "content-length": String(end - range.offset + 1),
        "accept-ranges": "bytes",
        etag: object.httpEtag,
        "cache-control": "public, max-age=86400",
        ...corsHeaders,
        "access-control-expose-headers":
          "content-range, content-length, accept-ranges",
      },
    });
  }

  // Full object request (no Range header)
  const object = await env.TILES.get(key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(object.body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(object.size),
      "accept-ranges": "bytes",
      etag: object.httpEtag,
      "cache-control": "public, max-age=86400",
      ...corsHeaders,
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith(".pmtiles")) {
      const key = url.pathname.slice(1);
      if (key.includes("..") || key.includes("//")) {
        return new Response("Bad Request", { status: 400 });
      }
      return handleTilesRequest(request, env, key);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
