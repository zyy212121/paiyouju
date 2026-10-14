import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { loadEnvironment } from "../config/environment.js";
import type { DatabaseClient } from "../db/client.js";
import { clearIntegrationDatabase, createIntegrationDatabase } from "./database.js";

const origin = "http://localhost:5173";

describe("HTTP security controls", () => {
  let database: DatabaseClient;

  beforeAll(() => {
    database = createIntegrationDatabase();
  });
  beforeEach(async () => clearIntegrationDatabase(database));
  afterAll(async () => database.$disconnect());

  it("returns UUID request ids and safe validation/unknown-route envelopes", async () => {
    const app = await buildApp({ database, environment: loadEnvironment(), logger: false, rateLimit: false });
    const invalid = await app.inject({ headers: { origin, "x-wepoker-request": "1" }, method: "POST", payload: { password: "secret", username: "x" }, url: "/api/auth/login" });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: "VALIDATION_ERROR", message: "请求参数不合法" } });
    expect(invalid.json().error.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(invalid.body).not.toMatch(/Zod|stack|src\\|src\//);
    const missing = await app.inject({ method: "GET", url: "/api/private-unknown" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("NOT_FOUND");
    await app.close();
  });

  it("allows only the configured CORS origin with credentials", async () => {
    const app = await buildApp({ database, environment: loadEnvironment(), logger: false, rateLimit: false });
    const allowed = await app.inject({ headers: { origin }, method: "OPTIONS", url: "/api/auth/login" });
    expect(allowed.headers["access-control-allow-origin"]).toBe(origin);
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    const denied = await app.inject({ headers: { origin: "https://evil.example" }, method: "OPTIONS", url: "/api/auth/login" });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("requires both the trusted Origin and explicit write-request header", async () => {
    const app = await buildApp({ database, environment: loadEnvironment(), logger: false, rateLimit: false });
    const missingHeader = await app.inject({
      headers: { origin },
      method: "POST",
      payload: { password: "example-password", username: "nobody" },
      url: "/api/auth/login",
    });
    expect(missingHeader.statusCode).toBe(403);
    expect(missingHeader.json().error.code).toBe("CSRF_HEADER_REQUIRED");

    const wrongOrigin = await app.inject({
      headers: { origin: "https://evil.example", "x-wepoker-request": "1" },
      method: "POST",
      payload: { password: "example-password", username: "nobody" },
      url: "/api/auth/login",
    });
    expect(wrongOrigin.statusCode).toBe(403);
    expect(wrongOrigin.json().error.code).toBe("ORIGIN_NOT_ALLOWED");

    const protectedWrite = await app.inject({
      headers: { origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: { password: "example-password", username: "nobody" },
      url: "/api/auth/login",
    });
    expect(protectedWrite.statusCode).not.toBe(403);
    const safeGet = await app.inject({ method: "GET", url: "/health" });
    expect(safeGet.statusCode).toBe(200);
    await app.close();
  });

  it("sets production security headers without unsafe script directives", async () => {
    const environment = loadEnvironment();
    const app = await buildApp({
      database,
      environment: { ...environment, CLIENT_ORIGIN: "https://poker.example.test", NODE_ENV: "production" },
      logger: false,
      rateLimit: false,
    });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["content-security-policy"]).not.toMatch(/unsafe-eval|unsafe-inline/);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["permissions-policy"]).toContain("camera=()");
    expect(response.headers["strict-transport-security"]).toContain("max-age=");
    await app.close();
  });

  it("enforces the JSON body limit before application parsing", async () => {
    const app = await buildApp({ database, environment: loadEnvironment(), logger: false, rateLimit: false });
    const response = await app.inject({
      headers: { "content-type": "application/json", origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: JSON.stringify({ nickname: "x".repeat(70_000), password: "example-password", username: "alice" }),
      url: "/api/auth/register",
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe("BODY_TOO_LARGE");
    await app.close();
  });

  it("maps malformed JSON and unsupported media types to safe client errors", async () => {
    const app = await buildApp({ database, environment: loadEnvironment(), logger: false, rateLimit: false });
    const malformed = await app.inject({
      headers: { "content-type": "application/json", origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: '{"username":',
      url: "/api/auth/login",
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(malformed.body).not.toMatch(/JSON\.parse|stack|SyntaxError/);

    const unsupported = await app.inject({
      headers: { "content-type": "application/xml", origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: "<login />",
      url: "/api/auth/login",
    });
    expect(unsupported.statusCode).toBe(415);
    expect(unsupported.json()).toMatchObject({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } });
    await app.close();
  });

  it("rate-limits registration, login and room join independently", async () => {
    const app = await buildApp({ database, environment: loadEnvironment(), logger: false });
    const loginResponses = [];
    for (let index = 0; index < 6; index += 1) {
      loginResponses.push(await app.inject({ headers: { origin, "x-wepoker-request": "1" }, method: "POST", payload: { password: "example-password", username: "nobody" }, url: "/api/auth/login" }));
    }
    expect(loginResponses.at(-1)?.statusCode).toBe(429);
    expect(loginResponses.at(-1)?.json().error.code).toBe("RATE_LIMITED");

    const registrationResponses = [];
    for (let index = 0; index < 6; index += 1) {
      registrationResponses.push(await app.inject({ headers: { origin, "x-forwarded-for": `127.0.1.${index}`, "x-wepoker-request": "1" }, method: "POST", payload: { nickname: "x", password: "short", username: "x" }, url: "/api/auth/register" }));
    }
    expect(registrationResponses.at(-1)?.statusCode).toBe(429);

    const joinResponses = [];
    for (let index = 0; index < 11; index += 1) {
      joinResponses.push(await app.inject({ headers: { origin, "x-wepoker-request": "1" }, method: "POST", payload: { roomCode: "999999" }, url: "/api/rooms/join" }));
    }
    expect(joinResponses.at(-1)?.statusCode).toBe(429);
    await app.close();
  }, 20_000);

  it("marks production cookies Secure", async () => {
    const environment = loadEnvironment();
    const app = await buildApp({ database, environment: { ...environment, NODE_ENV: "production" }, logger: false, rateLimit: false });
    const response = await app.inject({
      headers: { origin, "x-wepoker-request": "1" }, method: "POST", payload: { nickname: "爱丽丝", password: "example-password", phoneNumber: "18800000107" }, url: "/api/auth/register",
    });
    expect(response.headers["set-cookie"]).toContain("Secure");
    await app.close();
  });
});
