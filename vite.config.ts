import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json" with { type: "json" };

// Vite's SPA fallback answers any missing path with index.html + HTTP 200.
// Binary consumers (PMTiles archives, glyph PBFs) then parse HTML as their
// format and spam the console ("Wrong magic number", "Unimplemented type").
// Production hosting 404s these properly — make dev match.
const binaryAssets404: Plugin = {
  name: "binary-assets-404",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = decodeURIComponent((req.url ?? "").split("?")[0]);
      if (/\.(pmtiles|pbf)$/.test(path) && !existsSync(join("public", path))) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      next();
    });
  },
};

const gitSha = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
})();
const buildTime = new Date().toISOString().replace(/:\d{2}\.\d+Z$/, "Z"); // drop seconds

// Crawl date of the bundled NOAA tide/current harmonics (shown in About)
const tidesDataDate = (() => {
  try {
    const bundle = JSON.parse(
      readFileSync("./public/tides-stations.json", "utf8"),
    ) as { generated?: string };
    return bundle.generated ?? "unknown";
  } catch {
    return "unknown";
  }
})();

const isCapacitor = !!process.env.CAPACITOR;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(`${buildTime} ${gitSha}`),
    __TIDES_DATA_DATE__: JSON.stringify(tidesDataDate),
  },
  build: {
    target: "es2022",
    // Capacitor inlines sourcemaps into the JS, bloating the bundle to ~6.8 MB,
    // which is very slow to parse on weak e-ink WebView CPUs. Keep sourcemaps
    // for web/dev builds; drop them for the on-device Capacitor bundle.
    sourcemap: !isCapacitor,
  },
  server: {
    host: true,
    port: 5173,
    watch: {
      ignored: ["**/refs/**"],
    },
  },
  optimizeDeps: {
    exclude: [],
    entries: ["src/main.ts", "src/worker.ts"],
  },
  plugins: [
    binaryAssets404,
    // PWA/service worker is disabled for Capacitor builds — assets are bundled
    // locally and the SW only causes stale-cache problems in Android WebView.
    // (`disable` still provides a no-op virtual:pwa-register module.)
    // "autoUpdate" bakes skipWaiting + clientsClaim into the generated SW, so
    // a new build activates and takes control of open tabs without waiting
    // for every client to unload. App data lives in IndexedDB/localStorage/
    // OPFS, so an automatic activation is safe. AppUpdateNotifier registers
    // the SW itself (not via the generated virtual:pwa-register wrapper,
    // which would force an immediate reload) so it can reload at an idle
    // moment instead of mid-interaction.
    VitePWA({
      disable: isCapacitor,
      registerType: "autoUpdate",
      // Manual registration (AppUpdateNotifier.ts), not the generated
      // virtual:pwa-register wrapper — see the comment above.
      injectRegister: false,
      workbox: {
        // registerType only auto-sets these when injectRegister is left at
        // its "auto" default; set explicitly since injectRegister is false.
        skipWaiting: true,
        clientsClaim: true,
        // MapLibre glyphs (pbf) are bundled under public/fonts and
        // precached so labels render fully offline.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,json,pbf}"],
        // The landing page (served at "/" by the worker; app lives at /app)
        // is marketing, not app shell — keep it and its assets out of the
        // app's offline precache.
        globIgnores: [
          "**/*.pmtiles",
          "**/*.geojson",
          "**/*.search.json",
          "landing.html",
          "landing/**",
        ],
        navigateFallback: "/index.html",
        // Never satisfy navigations to the landing page or API from the SW —
        // "/" must always show the (possibly updated) marketing page, and
        // /api is dynamic.
        navigateFallbackDenylist: [/^\/$/, /^\/landing\.html$/, /^\/api\//],
        // Workbox's precache route maps "/" to the precached /index.html by
        // default (directoryIndex), BEFORE the navigation route runs — so the
        // denylist above never saw "/" and the SW served the app shell on the
        // landing page URL (then main.ts's old-PWA migration rewrote the URL
        // to /app: the About dialog's Website link led straight back to the
        // app). Disable it; "/" now reaches the network and gets the landing
        // page.
        directoryIndex: "",
      },
    }),
  ],
});
