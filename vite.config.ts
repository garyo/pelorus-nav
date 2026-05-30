import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json" with { type: "json" };

const gitSha = execSync("git rev-parse --short HEAD").toString().trim();
const buildTime = new Date().toISOString().replace(/:\d{2}\.\d+Z$/, "Z"); // drop seconds

const isCapacitor = !!process.env.CAPACITOR;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(`${buildTime} ${gitSha}`),
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
    // Disable PWA/service worker for Capacitor builds — assets are bundled
    // locally and the SW only causes stale-cache problems in Android WebView.
    ...(!isCapacitor
      ? [
          VitePWA({
            registerType: "autoUpdate",
            workbox: {
              // MapLibre glyphs (pbf) are bundled under public/fonts and
              // precached so labels render fully offline.
              globPatterns: ["**/*.{js,css,html,svg,png,woff2,json,pbf}"],
              globIgnores: ["**/*.pmtiles", "**/*.geojson", "**/*.search.json"],
              navigateFallback: "/index.html",
            },
          }),
        ]
      : []),
  ],
});
