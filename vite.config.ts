import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: true,
  },
  server: {
    host: true,
    port: 5173,
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,json}"],
        globIgnores: ["**/*.pmtiles", "**/*.geojson"],
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            // MapLibre glyphs CDN
            urlPattern: /^https:\/\/fonts\.openmaptiles\.org\//,
            handler: "CacheFirst",
            options: {
              cacheName: "maplibre-glyphs",
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
            },
          },
        ],
      },
    }),
  ],
});
