import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(name: string): Promise<string> {
  return readFile(new URL(name, new URL("../../../../", import.meta.url)), "utf8");
}

describe("production deployment contract", () => {
  it("builds a production-only non-root runtime with an explicit healthcheck", async () => {
    const dockerfile = await source("Dockerfile");
    expect(dockerfile).toMatch(/AS build/u);
    expect(dockerfile).toMatch(/AS migration/u);
    expect(dockerfile).toMatch(/pnpm install --frozen-lockfile/u);
    expect(dockerfile).toMatch(/pnpm deploy .*--prod/u);
    expect(dockerfile.match(/node:24\.16\.0-alpine@sha256:[a-f0-9]{64}/gu)).toHaveLength(2);
    expect(dockerfile).toMatch(/USER node/u);
    expect(dockerfile).toMatch(/HEALTHCHECK/u);
    expect(dockerfile).not.toMatch(/db seed|prisma db push/u);
  });

  it("publishes only compiled server files into the runtime stage", async () => {
    const serverPackage = JSON.parse(await source("apps/server/package.json")) as {
      readonly files?: readonly string[];
    };
    const dockerfile = await source("Dockerfile");
    expect(serverPackage.files).toEqual(["dist"]);
    expect(dockerfile).not.toMatch(/COPY --from=build \/workspace\/apps\/server/u);
    expect(dockerfile).not.toMatch(/COPY tools/u);
    expect(dockerfile).toMatch(/rm -rf \/release\/server\/dist\/integration/u);
  });

  it("keeps database migration separate and gates the app on it", async () => {
    const compose = await source("compose.prod.yaml");
    for (const service of ["postgres", "migration", "app", "caddy"]) {
      expect(compose).toMatch(new RegExp(`^  ${service}:`, "mu"));
    }
    expect(compose).toMatch(/condition: service_completed_successfully/u);
    expect(compose).toMatch(/postgres:17-alpine@sha256:[a-f0-9]{64}/u);
    expect(compose).not.toMatch(/5432:5432/u);
    expect(compose).not.toMatch(/db:seed|prisma db push/u);
    expect(compose).not.toContain("./apps");
  });

  it("provides public and explicitly local-only Caddy configurations", async () => {
    const publicCaddy = await source("Caddyfile");
    const localCaddy = await source("Caddyfile.local");
    expect(publicCaddy).toContain("{$APP_DOMAIN}");
    expect(publicCaddy).toMatch(/\/socket\.io\/\*/u);
    expect(publicCaddy).toMatch(/\/api\/\*/u);
    expect(publicCaddy).toMatch(/encode zstd gzip/u);
    expect(publicCaddy).toMatch(/request_body/u);
    expect(localCaddy).toMatch(/仅用于本地 Production-like 验证/u);
    expect(localCaddy).toMatch(/https:\/\/localhost/u);
    expect(localCaddy).toMatch(/tls internal/u);
  });

  it("documents every required production setting without committing a live file", async () => {
    const example = await source(".env.production.example");
    for (const key of [
      "NODE_ENV", "APP_VERSION", "APP_DOMAIN", "PORT", "DATABASE_URL",
      "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD", "CLIENT_ORIGIN",
      "SESSION_COOKIE_NAME", "SESSION_TTL_DAYS", "INITIAL_USER_POINTS",
      "ALLOW_LEGACY_USERNAME_LOGIN", "LOG_LEVEL", "MAX_SOCKETS_PER_USER",
      "RUNTIME_IDLE_EVICTION_SECONDS", "BACKUP_RETENTION_DAYS",
    ]) expect(example).toMatch(new RegExp(`^${key}=`, "mu"));
    expect(JSON.parse(await readFile(new URL("package.json", new URL("../../../../", import.meta.url)), "utf8"))).toHaveProperty("private", true);
  });

  it("defines non-deploying CI and manually triggered release checks", async () => {
    const ci = await source(".github/workflows/ci.yml");
    const release = await source(".github/workflows/release-check.yml");
    expect(ci).toMatch(/pull_request:/u);
    expect(ci).toMatch(/push:/u);
    expect(ci).toMatch(/pnpm install --frozen-lockfile/u);
    expect(ci).toMatch(/pnpm lint/u);
    expect(ci).toMatch(/pnpm typecheck/u);
    expect(ci).toMatch(/vitest run/u);
    expect(ci).toMatch(/pnpm test:e2e/u);
    expect(ci).toMatch(/docker build/u);
    expect(release).toMatch(/workflow_dispatch:/u);
    expect(release).toMatch(/--hands=100000/u);
    expect(release).toMatch(/backup:create/u);
    expect(release).toMatch(/backup:restore/u);
    expect(release).toMatch(/audit:data/u);
    expect(`${ci}\n${release}`).not.toMatch(/docker push|git tag|gh release|kubectl|\bssh\b/iu);
  });

  it("pins React Router beyond the production-reachable advisory range", async () => {
    const webPackage = JSON.parse(await source("apps/web/package.json")) as {
      readonly dependencies: Readonly<Record<string, string>>;
    };
    expect(webPackage.dependencies["react-router-dom"]).toMatch(/^(?:\^|~)?7\.(?:1[89]|[2-9][0-9])\./u);
  });

  it("keeps the release candidate version consistent across public surfaces", async () => {
    for (const packagePath of ["package.json", "apps/server/package.json", "apps/web/package.json"]) {
      const packageJson = JSON.parse(await source(packagePath)) as { readonly version: string };
      expect(packageJson.version, packagePath).toBe("0.1.0-rc.1");
    }
    expect(await source("apps/web/vite.config.ts")).toContain('const releaseVersion = "0.1.0-rc.1"');
    expect(await source("Dockerfile")).toMatch(/org\.opencontainers\.image\.version/u);
    expect(await source("compose.prod.yaml")).toMatch(/args:[\s\S]*APP_VERSION/u);
  });
});
