import { defineConfig, devices } from "@playwright/test";

// Override when another dev server (e.g. the VitePress docs site) holds
// :5173 — same idea as DOCS_SHOTS_BASE for tools/docs-shots.ts.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader"],
        },
      },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 5"],
        launchOptions: {
          args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader"],
        },
      },
    },
  ],
  webServer: {
    command: `bun dev --port ${new URL(baseURL).port || "5173"} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
