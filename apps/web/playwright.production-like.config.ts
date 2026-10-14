import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.WEPOKER_E2E_BASE_URL ?? "https://localhost";

export default defineConfig({
  testDir: "./e2e-production",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: "line",
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium-production-like", use: { ...devices["Desktop Chrome"] } }],
});
