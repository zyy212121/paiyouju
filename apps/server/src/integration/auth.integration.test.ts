import { Writable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { loadEnvironment } from "../config/environment.js";
import type { DatabaseClient } from "../db/client.js";
import { createAuthService } from "../modules/auth/auth.service.js";
import { createPhoneBindingService } from "../modules/account/phone-binding.service.js";
import { hashPassword } from "../security/passwords.js";
import { hashSessionToken } from "../security/sessions.js";
import { clearIntegrationDatabase, createIntegrationDatabase, createTestIdentity } from "./database.js";

const origin = "http://localhost:5173";
const registerBody = {
  nickname: "爱丽丝",
  password: "example-password",
  phoneNumber: "13800000001",
};

function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const setCookie = response.headers["set-cookie"];
  if (typeof setCookie !== "string") {
    throw new Error("expected a session cookie");
  }
  return setCookie.split(";", 1)[0] ?? "";
}

describe("authentication with PostgreSQL", () => {
  let database: DatabaseClient;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    database = createIntegrationDatabase();
    app = await buildApp({
      database,
      environment: loadEnvironment(),
      logger: false,
      rateLimit: false,
    });
    await app.ready();
  });

  beforeEach(async () => {
    await clearIntegrationDatabase(database);
  });

  afterAll(async () => {
    await app.close();
    await database.$disconnect();
  });

  it("registers User, Wallet, INITIAL_GRANT and hashed Session atomically", async () => {
    const response = await app.inject({
      headers: { origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: registerBody,
      url: "/api/auth/register",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      data: {
        user: {
          nickname: "爱丽丝",
          role: "USER",
          hasPhoneNumber: true,
          phoneMasked: "138****0001",
          walletBalance: 10_000,
        },
      },
    });
    expect(response.body).not.toMatch(/passwordHash|tokenHash|example-password/);

    const [user, wallet, ledger, session] = await Promise.all([
      database.user.findUniqueOrThrow({ where: { phoneNumber: registerBody.phoneNumber } }),
      database.wallet.findFirstOrThrow(),
      database.walletLedgerEntry.findFirstOrThrow(),
      database.userSession.findFirstOrThrow(),
    ]);
    const rawToken = sessionCookie(response).split("=")[1] ?? "";

    expect(user.username).toMatch(/^u_[a-f0-9]{24}$/u);
    expect(user.passwordHash).not.toBe(registerBody.password);
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(wallet).toMatchObject({ balance: 10_000, version: 1 });
    expect(ledger).toMatchObject({
      balanceAfter: 10_000,
      balanceBefore: 0,
      sequence: 1,
      signedAmount: 10_000,
      type: "INITIAL_GRANT",
    });
    expect(session.tokenHash).not.toBe(rawToken);
    expect(session.tokenHash).toBe(hashSessionToken(rawToken));
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("SameSite=Lax");
    expect(response.headers["set-cookie"]).toContain("Path=/");
  });

  it("rolls back a second registration when its Session token collides", async () => {
    const auth = createAuthService(database, loadEnvironment(), {
      createToken: () => "x".repeat(43),
    });
    await auth.register(registerBody);

    await expect(
      auth.register({
        nickname: "鲍勃",
        password: "example-password",
        phoneNumber: "13800000002",
      }),
    ).rejects.toMatchObject({ code: "SESSION_TOKEN_COLLISION" });

    expect(await database.user.count()).toBe(1);
    expect(await database.wallet.count()).toBe(1);
    expect(await database.walletLedgerEntry.count()).toBe(1);
  });

  it("assigns a server-selected library avatar at registration and returns it in the session identity", async () => {
    const auth = createAuthService(database, loadEnvironment(), {
      createAvatarId: () => "avatar-07",
      createToken: () => "avatar-registration-token".padEnd(43, "x"),
      createUsername: () => "u_avatar_registration",
    });

    const result = await auth.register(registerBody);

    expect(result.user.avatarId).toBe("avatar-07");
    expect(await database.user.findUniqueOrThrow({ where: { id: result.user.id } })).toMatchObject({ avatarId: "avatar-07" });
  });

  it("updates an authenticated profile avatar only from the fixed library", async () => {
    const registered = await app.inject({ headers: { origin, "x-wepoker-request": "1" }, method: "POST", payload: registerBody, url: "/api/auth/register" });
    const cookie = sessionCookie(registered);

    const updated = await app.inject({ headers: { cookie, origin, "x-wepoker-request": "1" }, method: "PATCH", payload: { avatarId: "avatar-12" }, url: "/api/profile" });
    const invalid = await app.inject({ headers: { cookie, origin, "x-wepoker-request": "1" }, method: "PATCH", payload: { avatarId: "avatar-99" }, url: "/api/profile" });

    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ data: { avatarId: "avatar-12", nickname: "爱丽丝" } });
    expect(invalid.statusCode).toBe(400);
    expect(await database.user.findUniqueOrThrow({ where: { phoneNumber: registerBody.phoneNumber } })).toMatchObject({ avatarId: "avatar-12" });
  });

  it("rejects duplicate phone registrations with one stable code", async () => {
    await app.inject({ headers: { origin, "x-wepoker-request": "1" }, method: "POST", payload: registerBody, url: "/api/auth/register" });
    const duplicate = await app.inject({
      headers: { origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: { ...registerBody, nickname: "另一位用户" },
      url: "/api/auth/register",
    });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: { code: "PHONE_NUMBER_TAKEN" } });
  });

  it("uses one public error for a missing user and a wrong password", async () => {
    await app.inject({ headers: { origin, "x-wepoker-request": "1" }, method: "POST", payload: registerBody, url: "/api/auth/register" });
    const missing = await app.inject({
      headers: { origin, "x-wepoker-request": "1" }, method: "POST", payload: { identifier: "13900000009", password: "example-password" }, url: "/api/auth/login",
    });
    const wrong = await app.inject({
      headers: { origin, "x-wepoker-request": "1" }, method: "POST", payload: { identifier: registerBody.phoneNumber, password: "wrong-password" }, url: "/api/auth/login",
    });

    expect(missing.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(missing.json().error.code).toBe("AUTH_INVALID_CREDENTIALS");
    expect(wrong.json().error.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("authenticates /api/me, rejects expired/revoked sessions, and logs out idempotently", async () => {
    const registered = await app.inject({ headers: { origin, "x-wepoker-request": "1" }, method: "POST", payload: registerBody, url: "/api/auth/register" });
    const cookie = sessionCookie(registered);

    const me = await app.inject({ headers: { cookie }, method: "GET", url: "/api/me" });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ data: { hasPhoneNumber: true, phoneMasked: "138****0001", walletBalance: 10_000 } });
    expect(me.body).not.toMatch(/passwordHash|tokenHash/);

    const session = await database.userSession.findFirstOrThrow();
    await database.userSession.update({ where: { id: session.id }, data: { expiresAt: new Date(0) } });
    const expired = await app.inject({ headers: { cookie }, method: "GET", url: "/api/me" });
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe("AUTH_REQUIRED");

    const login = await app.inject({
      headers: { origin, "x-wepoker-request": "1" }, method: "POST", payload: { identifier: registerBody.phoneNumber, password: registerBody.password }, url: "/api/auth/login",
    });
    const loginCookie = sessionCookie(login);
    const activeSession = await database.userSession.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    await database.userSession.update({ where: { id: activeSession.id }, data: { revokedAt: new Date() } });
    const revoked = await app.inject({ headers: { cookie: loginCookie }, method: "GET", url: "/api/me" });
    expect(revoked.statusCode).toBe(401);

    const logout = await app.inject({ headers: { cookie: loginCookie, origin, "x-wepoker-request": "1" }, method: "POST", url: "/api/auth/logout" });
    const repeated = await app.inject({ headers: { cookie: loginCookie, origin, "x-wepoker-request": "1" }, method: "POST", url: "/api/auth/logout" });
    expect(logout.statusCode).toBe(200);
    expect(repeated.statusCode).toBe(200);
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
  });

  it("requires authentication and rejects an untrusted modifying origin", async () => {
    const unauthenticated = await app.inject({ method: "GET", url: "/api/me" });
    const untrusted = await app.inject({
      headers: { origin: "https://evil.example", "x-wepoker-request": "1" }, method: "POST", payload: registerBody, url: "/api/auth/register",
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json().error.requestId).toEqual(expect.any(String));
    expect(untrusted.statusCode).toBe(403);
    expect(untrusted.json().error.code).toBe("ORIGIN_NOT_ALLOWED");
    expect(untrusted.json().error.message).toBe("访问地址与服务器配置不一致，请使用启动终端显示的网址重新打开");
  });

  it("serializes concurrent registration of one phone into one atomic user and wallet", async () => {
    const environment = loadEnvironment();
    const { createDatabaseClient } = await import("../db/client.js");
    const second = createDatabaseClient(environment.DATABASE_URL, environment.DATABASE_POOL_MAX);
    try {
      const results = await Promise.allSettled([
        createAuthService(database, environment).register(registerBody),
        createAuthService(second, environment).register({ ...registerBody, nickname: "并发账户" }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({ code: "PHONE_NUMBER_TAKEN" });
      expect(await database.user.count({ where: { phoneNumber: registerBody.phoneNumber } })).toBe(1);
      expect(await database.wallet.count()).toBe(1);
      expect(await database.walletLedgerEntry.count({ where: { type: "INITIAL_GRANT" } })).toBe(1);
    } finally { await second.$disconnect(); }
  });

  it("allows a legacy username login in test, binds a phone once, and preserves the original account and wallet", async () => {
    const legacy = await createTestIdentity(database, "alice", 1_234);
    await database.user.update({ data: { passwordHash: await hashPassword("legacy-password") }, where: { id: legacy.userId } });
    const walletBefore = await database.wallet.findUniqueOrThrow({ where: { userId: legacy.userId } });
    const login = await app.inject({ headers: { origin, "x-wepoker-request": "1" }, method: "POST", payload: { identifier: "alice", password: "legacy-password" }, url: "/api/auth/login" });
    expect(login.statusCode, login.body).toBe(200);
    const cookie = sessionCookie(login);
    const payload = { currentPassword: "legacy-password", operationId: "92000000-0000-4000-8000-000000000001", phoneNumber: "13800000009" };
    const first = await app.inject({ headers: { cookie, origin, "x-wepoker-request": "1" }, method: "POST", payload, url: "/api/account/phone" });
    const replay = await app.inject({ headers: { cookie, origin, "x-wepoker-request": "1" }, method: "POST", payload, url: "/api/account/phone" });
    expect(first.statusCode, first.body).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(first.json().data).toMatchObject({ alreadyBound: false, hasPhoneNumber: true, phoneMasked: "138****0009" });
    expect(first.body).not.toContain("13800000009");
    expect((await database.user.findUniqueOrThrow({ where: { id: legacy.userId } })).phoneNumber).toBe("13800000009");
    expect(await database.wallet.findUniqueOrThrow({ where: { userId: legacy.userId } })).toEqual(walletBefore);

    const replace = await app.inject({ headers: { cookie, origin, "x-wepoker-request": "1" }, method: "POST", payload: { ...payload, operationId: "92000000-0000-4000-8000-000000000002", phoneNumber: "13900000009" }, url: "/api/account/phone" });
    expect(replace.json().error.code).toBe("PHONE_ALREADY_BOUND");
    expect((await app.inject({ headers: { cookie }, method: "GET", url: "/api/me" })).body).not.toContain("13800000009");
  });

  it("rejects a wrong current password and serializes two legacy users binding the same phone", async () => {
    const alice = await createTestIdentity(database, "alice", 1_000);
    const bob = await createTestIdentity(database, "bob", 1_000);
    const passwordHash = await hashPassword("legacy-password");
    await database.user.updateMany({ data: { passwordHash }, where: { id: { in: [alice.userId, bob.userId] } } });
    await expect(createPhoneBindingService(database).bind(alice.userId, { currentPassword: "wrong-password", operationId: "92000000-0000-4000-8000-000000000003", phoneNumber: "13700000001" })).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });

    const environment = loadEnvironment();
    const { createDatabaseClient } = await import("../db/client.js");
    const second = createDatabaseClient(environment.DATABASE_URL, environment.DATABASE_POOL_MAX);
    try {
      const results = await Promise.allSettled([
        createPhoneBindingService(database).bind(alice.userId, { currentPassword: "legacy-password", operationId: "92000000-0000-4000-8000-000000000004", phoneNumber: "13700000001" }),
        createPhoneBindingService(second).bind(bob.userId, { currentPassword: "legacy-password", operationId: "92000000-0000-4000-8000-000000000005", phoneNumber: "13700000001" }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({ code: "PHONE_NUMBER_TAKEN" });
      expect(await database.user.count({ where: { phoneNumber: "13700000001" } })).toBe(1);
    } finally { await second.$disconnect(); }
  });

  it("redacts full phone identifiers from ordinary HTTP logs and public responses", async () => {
    let logs = "";
    const stream = new Writable({ write(chunk, _encoding, callback) { logs += chunk.toString(); callback(); } });
    const loggedApp = await buildApp({ database, environment: loadEnvironment(), logger: { level: "info", stream }, rateLimit: false });
    try {
      const response = await loggedApp.inject({ headers: { origin, "x-wepoker-request": "1" }, method: "POST", payload: registerBody, url: "/api/auth/register" });
      expect(response.statusCode, response.body).toBe(201);
      expect(response.body).not.toContain(registerBody.phoneNumber);
      expect(response.body).toContain("138****0001");
    } finally { await loggedApp.close(); }
    expect(logs).not.toContain(registerBody.phoneNumber);
  });
});
