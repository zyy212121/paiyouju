import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ["src/**/*.postgres.integration.test.ts"],
    maxWorkers: 1,
    setupFiles: ["src/integration/load-docker-test-environment.ts"],
    testTimeout: 20_000,
  },
});
