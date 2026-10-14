import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const rootUrl = new URL("../../../../", import.meta.url);

describe("Step 5 Docker PostgreSQL contract", () => {
  it("defines isolated standard PostgreSQL development and test services", async () => {
    const compose = await readFile(new URL("compose.yaml", rootUrl), "utf8");

    expect(compose).toContain("postgres-dev:");
    expect(compose).toContain("postgres-test:");
    expect(compose).toContain("postgres:17-alpine");
    expect(compose).toContain("127.0.0.1:55432:5432");
    expect(compose).toContain("127.0.0.1:55433:5432");
    expect(compose).toContain("postgres-dev-data:/var/lib/postgresql/data");
    expect(compose).toContain("postgres-test-data:/var/lib/postgresql/data");
    expect(compose.match(/healthcheck:/g)).toHaveLength(2);
    expect(compose.match(/restart: unless-stopped/g)).toHaveLength(2);
  });

  it("exposes explicit Docker database lifecycle commands", async () => {
    const rootPackageJson = JSON.parse(
      await readFile(new URL("package.json", rootUrl), "utf8"),
    ) as { readonly scripts: Readonly<Record<string, string>> };
    const serverPackageJson = JSON.parse(
      await readFile(new URL("apps/server/package.json", rootUrl), "utf8"),
    ) as { readonly scripts: Readonly<Record<string, string>> };

    for (const name of [
      "db:docker:up",
      "db:docker:down",
      "db:docker:status",
      "db:docker:logs",
      "db:docker:reset:dev",
      "db:docker:reset:test",
      "db:migrate:docker",
      "db:migrate:test:docker",
      "db:seed:docker",
      "db:seed:test:docker",
    ]) {
      expect(rootPackageJson.scripts[name], `${name} is missing`).toBeTypeOf("string");
    }
    expect(serverPackageJson.scripts["test:integration"]).toMatch(
      /db:migrate:test:docker.*WEPOKER_STANDARD_POSTGRES=1/,
    );
  });

  it("uses standard Docker PostgreSQL for the default root E2E gate without recursion", async () => {
    const rootPackageJson = JSON.parse(
      await readFile(new URL("package.json", rootUrl), "utf8"),
    ) as { readonly scripts: Readonly<Record<string, string>> };
    const webPackageJson = JSON.parse(
      await readFile(new URL("apps/web/package.json", rootUrl), "utf8"),
    ) as { readonly scripts: Readonly<Record<string, string>> };
    const wrapper = await readFile(new URL("apps/server/scripts/run-docker-e2e.ts", rootUrl), "utf8");

    expect(rootPackageJson.scripts["test:e2e"]).toContain("run-docker-e2e.ts");
    expect(rootPackageJson.scripts["test:e2e:docker"]).toContain("run-docker-e2e.ts");
    expect(rootPackageJson.scripts["test:e2e:local"]).toContain("@paiyouju/web test:e2e");
    expect(webPackageJson.scripts["test:e2e:browsers"]).toContain("run-docker-e2e.ts");
    expect(webPackageJson.scripts["test:e2e:browsers"]).toContain("WEPOKER_E2E_MODE=browsers");
    expect(webPackageJson.scripts["test:e2e:browsers:local"]).toContain("playwright.release.config.ts");
    expect(wrapper).toContain('"pnpm", "test:e2e:local"');
    expect(wrapper).toContain('"--filter", "@paiyouju/web", "test:e2e:browsers:local"');
    expect(wrapper).not.toContain('"pnpm", "test:e2e"');
    expect(wrapper).toContain('"up", "-d", "--wait", "postgres-test"');
    expect(wrapper).toContain('"stop", "postgres-test"');
    expect(wrapper).toContain('"rm", "-f", "postgres-test"');
    expect(wrapper).toContain('process.once("SIGINT"');
    expect(wrapper).toContain('process.once("SIGTERM"');
    expect(wrapper).toContain("try {");
    expect(wrapper).toContain("} finally {");
  });
});
