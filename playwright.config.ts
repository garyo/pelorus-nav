import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:5173",
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
    command: "bun dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
});
