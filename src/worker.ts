/**
 * Cloudflare Worker entry point.
 * Serves nautical.pmtiles from R2; everything else from static assets.
 */

interface Env {
  ASSETS: Fetcher;
  TILES: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Serve PMTiles from R2
    if (url.pathname.endsWith(".pmtiles")) {
      const key = url.pathname.slice(1); // strip leading /
      const object = await env.TILES.get(key);
      if (!object) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(object.body, {
        headers: {
          "content-type": "application/octet-stream",
          etag: object.httpEtag,
          "cache-control": "public, max-age=86400",
          "access-control-allow-origin": "*",
        },
      });
    }

    // Everything else: static assets
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
