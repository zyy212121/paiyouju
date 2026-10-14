import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loadEnvironment, resolveRootEnvironmentPath } from "./environment.js";

const required = {
  CLIENT_ORIGIN: "http://localhost:5173",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/wepoker",
};

const productionRequired = {
  ...required,
  APP_DOMAIN: "poker.example.com",
  APP_VERSION: "7.0.0",
  CLIENT_ORIGIN: "https://poker.example.com",
  DATABASE_URL: "postgresql://wepoker:a-strong-production-password@postgres:5432/wepoker",
};

describe("environment", () => {
  it("applies documented non-production defaults", () => {
    expect(loadEnvironment(required)).toMatchObject({
      APP_DOMAIN: "localhost",
      APP_VERSION: "0.0.0-dev",
      ADMIN_ROOM_FILE_LOG_ENABLED: true,
      ADMIN_ROOM_CONNECTION_PROBES_ENABLED: true,
      BACKUP_RETENTION_DAYS: 7,
      HOST: "0.0.0.0",
      INITIAL_USER_POINTS: 10_000,
      DATABASE_POOL_MAX: 10,
      LOG_LEVEL: "info",
      NODE_ENV: "development",
      MAX_SOCKETS_PER_USER: 5,
      PORT: 3_000,
      RUNTIME_IDLE_EVICTION_SECONDS: 300,
      SESSION_COOKIE_NAME: "wepoker_session",
      SESSION_TTL_DAYS: 14,
    });
  });

  it("accepts explicit bounded operational settings", () => {
    expect(loadEnvironment({
      ...required,
      APP_DOMAIN: "poker.example.com",
      APP_VERSION: "7.0.0",
      BACKUP_RETENTION_DAYS: "14",
      MAX_SOCKETS_PER_USER: "8",
      RUNTIME_IDLE_EVICTION_SECONDS: "600",
    })).toMatchObject({
      APP_DOMAIN: "poker.example.com",
      APP_VERSION: "7.0.0",
      BACKUP_RETENTION_DAYS: 14,
      MAX_SOCKETS_PER_USER: 8,
      RUNTIME_IDLE_EVICTION_SECONDS: 600,
    });
    expect(() => loadEnvironment({ ...required, MAX_SOCKETS_PER_USER: "0" })).toThrow();
    expect(() => loadEnvironment({ ...required, RUNTIME_IDLE_EVICTION_SECONDS: "29" })).toThrow();
    expect(() => loadEnvironment({ ...required, BACKUP_RETENTION_DAYS: "0" })).toThrow();
  });

  it("rejects incomplete or visibly weak production configuration", () => {
    const production = {
      ...productionRequired,
      NODE_ENV: "production",
    } as const;

    expect(loadEnvironment(production)).toMatchObject({
      ADMIN_ROOM_FILE_LOG_ENABLED: false,
      ADMIN_ROOM_CONNECTION_PROBES_ENABLED: false,
      APP_DOMAIN: "poker.example.com",
      APP_VERSION: "7.0.0",
      NODE_ENV: "production",
    });
    expect(() => loadEnvironment({ ...production, APP_VERSION: "change-me" })).toThrow();
    expect(() => loadEnvironment({ ...production, CLIENT_ORIGIN: "http://poker.example.com" })).toThrow();
    expect(() => loadEnvironment({
      ...production,
      DATABASE_URL: "postgresql://wepoker:password@postgres:5432/wepoker",
    })).toThrow();
    expect(() => loadEnvironment({
      ...production,
      DATABASE_URL: "postgresql://wepoker:123456@postgres:5432/wepoker",
    })).toThrow();
    expect(() => loadEnvironment({
      ...production,
      DATABASE_URL: "postgresql://wepoker:replace-with-random-32-plus-characters@postgres:5432/wepoker",
    })).toThrow();
    expect(() => loadEnvironment({ ...production, APP_DOMAIN: "https://poker.example.com" })).toThrow();
  });

  it("allows administrator-room connection probes to be disabled without changing other diagnostics", () => {
    expect(loadEnvironment({
      ...required,
      ADMIN_ROOM_CONNECTION_PROBES_ENABLED: "false",
    }).ADMIN_ROOM_CONNECTION_PROBES_ENABLED).toBe(false);
    expect(loadEnvironment({
      ...productionRequired,
      ADMIN_ROOM_CONNECTION_PROBES_ENABLED: "true",
      NODE_ENV: "production",
    }).ADMIN_ROOM_CONNECTION_PROBES_ENABLED).toBe(true);
  });

  it("allows the complete administrator-room file log to be explicitly enabled or disabled", () => {
    expect(loadEnvironment({
      ...required,
      ADMIN_ROOM_FILE_LOG_ENABLED: "false",
    }).ADMIN_ROOM_FILE_LOG_ENABLED).toBe(false);
    expect(loadEnvironment({
      ...productionRequired,
      ADMIN_ROOM_FILE_LOG_ENABLED: "true",
      NODE_ENV: "production",
    }).ADMIN_ROOM_FILE_LOG_ENABLED).toBe(true);
  });

  it("rejects unsafe point values, non-PostgreSQL URLs, and a changed TTL", () => {
    expect(() =>
      loadEnvironment({ ...required, INITIAL_USER_POINTS: "2000000001" }),
    ).toThrow();
    expect(() =>
      loadEnvironment({ ...required, DATABASE_URL: "file:local.db" }),
    ).toThrow();
    expect(() => loadEnvironment({ ...required, SESSION_TTL_DAYS: "30" })).toThrow();
    expect(() => loadEnvironment({ ...required, DATABASE_POOL_MAX: "0" })).toThrow();
  });

  it("requires production seed credentials to remain absent", () => {
    expect(() =>
      loadEnvironment({
        ...productionRequired,
        DEV_SEED_PASSWORD: "must-not-run-in-production",
        NODE_ENV: "production",
      }),
    ).toThrow();
  });

  it("allows legacy username login only outside production", () => {
    expect(loadEnvironment({ ...required, NODE_ENV: "test" }).ALLOW_LEGACY_USERNAME_LOGIN).toBe(true);
    expect(loadEnvironment({ ...productionRequired, NODE_ENV: "production" }).ALLOW_LEGACY_USERNAME_LOGIN).toBe(false);
    expect(loadEnvironment({ ...required, ALLOW_LEGACY_USERNAME_LOGIN: "false", NODE_ENV: "development" }).ALLOW_LEGACY_USERNAME_LOGIN).toBe(false);
    expect(() => loadEnvironment({ ...productionRequired, ALLOW_LEGACY_USERNAME_LOGIN: "true", NODE_ENV: "production" })).toThrow();
  });

  it("allows a fixed deck only in the test environment", () => {
    expect(() => loadEnvironment({ ...required, TEST_FIXED_DECK: "standard" })).toThrow();
    expect(loadEnvironment({ ...required, NODE_ENV: "test", TEST_FIXED_DECK: "standard" }).TEST_FIXED_DECK).toBe("standard");
    expect(loadEnvironment({ ...required, NODE_ENV: "test", TEST_FIXED_DECK: "step6_5_acceptance" }).TEST_FIXED_DECK).toBe("step6_5_acceptance");
    expect(() => loadEnvironment({ ...productionRequired, NODE_ENV: "production", TEST_FIXED_DECK: "standard" })).toThrow();
    expect(loadEnvironment({ ...required, NODE_ENV: "test", TEST_TABLE_FAULT: "after-settlement-commit" }).TEST_TABLE_FAULT).toBe("after-settlement-commit");
    expect(() => loadEnvironment({ ...productionRequired, NODE_ENV: "production", TEST_TABLE_FAULT: "after-settlement-commit" })).toThrow();
  });

  it("applies registration-compatible validation to seed administrator identity", () => {
    expect(() => loadEnvironment({ ...required, ADMIN_USERNAME: "bad-name" })).toThrow();
    expect(() => loadEnvironment({ ...required, ADMIN_NICKNAME: "<admin>" })).toThrow();
    expect(() => loadEnvironment({ ...required, ADMIN_NICKNAME: "admin\u0000" })).toThrow();
  });

  it("resolves source and compiled modules to the repository root", () => {
    expect(
      resolveRootEnvironmentPath("file:///D:/wepoker/apps/server/src/config.ts"),
    ).toBe(fileURLToPath("file:///D:/wepoker/.env"));
    expect(
      resolveRootEnvironmentPath("file:///D:/wepoker/apps/server/dist/config.js"),
    ).toBe(fileURLToPath("file:///D:/wepoker/.env"));
  });
});
