import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-pwa",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "html",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium-production-pwa", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "corepack pnpm exec vite preview --host 127.0.0.1 --port 4174 --strictPort",
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:4174/login",
  },
});
