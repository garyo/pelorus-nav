import { cpus } from "node:os";
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
  // Each spec drives a full MapLibre map through software WebGL (swiftshader),
  // which is CPU-bound: over-subscribing workers doesn't make the suite race,
  // it starves every test until they blow the timeout together. Two workers on
  // a 4-core hosted runner leaves headroom for the dev server and the GPU
  // threads, and the timeout is raised to match the slower machine.
  //
  // Locally the same budget, rather than Playwright's default of half the
  // cores — which scales the *wrong* way here, since a bigger machine then
  // runs more swiftshader instances against the same fixed timeout. Measured
  // on a 10-core Mac: at 5 workers (the old default) the two heaviest specs
  // took 26.3 s and 29.7 s against a 30 s cap, and anything else running on
  // the machine tipped them over; at 3 they take 14.7 s and 21.0 s *and* the
  // whole suite finishes sooner (38.6 s vs 42.4 s). Past ~3 there is no
  // throughput left to win — only latency to lose.
  workers: process.env.CI ? 2 : Math.max(2, Math.floor(cpus().length / 3)),
  // Local runs share the machine with whatever else the developer has open
  // (a dev server, a browser, an editor's language server), so the cap is not
  // as tight as the measured times suggest it could be.
  timeout: process.env.CI ? 90_000 : 60_000,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "html",
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
