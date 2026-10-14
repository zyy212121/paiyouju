import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-restore",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: "line",
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: process.env.WEPOKER_E2E_BASE_URL ?? "https://localhost",
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium-restored-data", use: { ...devices["Desktop Chrome"] } }],
});
