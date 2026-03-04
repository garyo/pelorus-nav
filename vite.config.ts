import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: true,
  },
  server: {
    host: true,
    port: 5173,
  },
});
