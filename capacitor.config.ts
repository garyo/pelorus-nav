import type { CapacitorConfig } from "@capacitor/cli";

const DEV_SERVER = process.env.CAP_DEV_SERVER;

const config: CapacitorConfig = {
  appId: "nav.pelorus.app",
  appName: "Pelorus Nav",
  webDir: "dist",
  server: {
    androidScheme: "https",
    // When CAP_DEV_SERVER is set, load from Vite dev server for live reload
    // and proper Range request support for PMTiles streaming.
    // Usage: CAP_DEV_SERVER=http://192.168.0.46:5173 bun run cap:run
    ...(DEV_SERVER ? { url: DEV_SERVER, cleartext: true } : {}),
  },
};

export default config;
