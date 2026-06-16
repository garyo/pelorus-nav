import type { CapacitorConfig } from "@capacitor/cli";

const DEV_SERVER = process.env.CAP_DEV_SERVER;

const config: CapacitorConfig = {
  appId: "nav.pelorus.app",
  appName: "Pelorus Nav",
  webDir: "dist",
  server: {
    androidScheme: "https",
    // Pin the iOS scheme explicitly. The WebView origin (scheme://hostname)
    // is the storage key for IndexedDB/OPFS — changing it orphans downloaded
    // charts and recorded tracks, so keep this stable across releases.
    iosScheme: "capacitor",
    // When CAP_DEV_SERVER is set, load from Vite dev server for live reload
    // and proper Range request support for PMTiles streaming.
    // Usage: CAP_DEV_SERVER=http://192.168.0.46:5173 bun run cap:run
    ...(DEV_SERVER ? { url: DEV_SERVER, cleartext: true } : {}),
  },
};

export default config;
