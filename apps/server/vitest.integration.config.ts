import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ["src/**/*.integration.test.ts"],
    maxWorkers: 1,
    setupFiles: [process.env.WEPOKER_STANDARD_POSTGRES === "1"
      ? "src/integration/load-docker-test-environment.ts"
      : "src/integration/load-test-environment.ts"],
  },
});
