import { defineConfig, devices } from "@playwright/test";

// Override when another dev server (e.g. the VitePress docs site) holds
// :5173 — same idea as DOCS_SHOTS_BASE for tools/docs-shots.ts.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

// The S-57 render-coverage harness is a report generator, not a regression
// test: it steps a MapLibre map through every variant in the test-chart
// manifest, which takes minutes and dwarfs the rest of the suite. It gets its
// own project (`bun run e2e:chart-coverage`) so the browser projects stay fast.
const CHART_COVERAGE = "**/render-test-chart.spec.ts";

const webglArgs = [
  "--enable-webgl",
  "--use-gl=angle",
  "--use-angle=swiftshader",
];

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // The specs are independent and short; swiftshader handles concurrent WebGL
  // contexts fine. Capped in CI because hosted runners are small.
  workers: process.env.CI ? 4 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: CHART_COVERAGE,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: webglArgs },
      },
    },
    {
      name: "firefox",
      testIgnore: CHART_COVERAGE,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testIgnore: CHART_COVERAGE,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile-chrome",
      testIgnore: CHART_COVERAGE,
      use: {
        ...devices["Pixel 5"],
        launchOptions: { args: webglArgs },
      },
    },
    {
      name: "chart-coverage",
      testMatch: CHART_COVERAGE,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: webglArgs },
      },
    },
  ],
  webServer: {
    command: `bun dev --port ${new URL(baseURL).port || "5173"} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
