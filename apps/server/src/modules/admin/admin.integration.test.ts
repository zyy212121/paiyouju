import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import { loadEnvironment } from "../../config/environment.js";
import type { DatabaseClient } from "../../db/client.js";
import {
  clearIntegrationDatabase,
  createIntegrationDatabase,
  createTestIdentity,
} from "../../integration/database.js";

const origin = "http://localhost:5173";

describe("Step 7 administrator API", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: DatabaseClient;

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

  beforeEach(async () => clearIntegrationDatabase(database));

  afterAll(async () => {
    await app.close();
    await database.$disconnect();
  });

  it("rejects anonymous and ordinary users without disclosing the resource", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/api/admin/dashboard" });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().error.code).toBe("AUTH_REQUIRED");

    const ordinary = await createTestIdentity(database, "ordinary-admin-test", 1_000);
    const denied = await app.inject({
      headers: { cookie: ordinary.cookie, origin },
      method: "GET",
      url: "/api/admin/users/non-existent-user",
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("ADMIN_REQUIRED");
    expect(denied.body).not.toContain("non-existent-user");
  });

  it("uses the current database role instead of a client claim", async () => {
    const identity = await createTestIdentity(database, "promoted-admin", 1_000);
    await database.user.update({ data: { role: "ADMIN" }, where: { id: identity.userId } });
    const allowed = await app.inject({
      headers: { cookie: identity.cookie, origin, "x-client-role": "USER" },
      method: "GET",
      url: "/api/admin/dashboard",
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().data).toMatchObject({
      databaseStatus: "ready",
      usersTotal: 1,
      walletTotalBalance: 1_000,
    });

    await database.user.update({ data: { role: "USER" }, where: { id: identity.userId } });
    const revokedRole = await app.inject({
      headers: { cookie: identity.cookie, origin, "x-client-role": "ADMIN" },
      method: "GET",
      url: "/api/admin/dashboard",
    });
    expect(revokedRole.statusCode).toBe(403);
    expect(revokedRole.json().error.code).toBe("ADMIN_REQUIRED");
  });

  it("searches a full phone number but returns only its mask", async () => {
    const admin = await createTestIdentity(database, "mask-admin", 1_000);
    const target = await createTestIdentity(database, "mask-target", 2_000);
    await database.user.update({ data: { role: "ADMIN" }, where: { id: admin.userId } });
    await database.user.update({ data: { phoneNumber: "13800001234" }, where: { id: target.userId } });

    const queryLeak = await app.inject({
      headers: { cookie: admin.cookie, origin },
      method: "GET",
      query: { search: "13800001234" },
      url: "/api/admin/users",
    });
    expect(queryLeak.statusCode).toBe(400);
    expect(queryLeak.json().error.code).toBe("PHONE_SEARCH_REQUIRES_BODY");

    const response = await app.inject({
      headers: { cookie: admin.cookie, origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: { search: "13800001234" },
      url: "/api/admin/users/search",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toHaveLength(1);
    expect(response.json().data.items[0]).toMatchObject({
      id: target.userId,
      phoneMasked: "138****1234",
      walletBalance: 2_000,
    });
    expect(response.body).not.toContain("13800001234");
  });

  it("adjusts a wallet, ledger and audit log exactly once in one operation", async () => {
    const admin = await createTestIdentity(database, "adjust-admin", 1_000);
    const target = await createTestIdentity(database, "adjust-target", 2_000);
    await database.user.update({ data: { role: "ADMIN" }, where: { id: admin.userId } });
    const operationId = randomUUID();
    const payload = { operationId, reason: "manual test correction", signedAmount: 250 };

    const first = await app.inject({
      headers: { cookie: admin.cookie, origin, "x-wepoker-request": "1" },
      method: "POST",
      payload,
      url: `/api/admin/users/${target.userId}/wallet-adjustments`,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({
      balanceAfter: 2_250,
      balanceBefore: 2_000,
      replayed: false,
      signedAmount: 250,
    });

    const replay = await app.inject({
      headers: { cookie: admin.cookie, origin, "x-wepoker-request": "1" },
      method: "POST",
      payload,
      url: `/api/admin/users/${target.userId}/wallet-adjustments`,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data).toMatchObject({ balanceAfter: 2_250, replayed: true });

    const [wallet, adjustments, auditLogs, receipts] = await Promise.all([
      database.wallet.findUniqueOrThrow({ where: { userId: target.userId } }),
      database.walletLedgerEntry.count({ where: { type: "ADMIN_ADJUSTMENT", userId: target.userId } }),
      database.auditLog.count({ where: { action: "ADMIN_WALLET_ADJUSTMENT", operationId } }),
      database.requestIdempotency.count({ where: { actorId: admin.userId, key: operationId, scope: "ADMIN_WALLET_ADJUSTMENT" } }),
    ]);
    expect(wallet.balance).toBe(2_250);
    expect(adjustments).toBe(1);
    expect(auditLogs).toBe(1);
    expect(receipts).toBe(1);

    const conflict = await app.inject({
      headers: { cookie: admin.cookie, origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: { ...payload, signedAmount: 251 },
      url: `/api/admin/users/${target.userId}/wallet-adjustments`,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("preserves wallet bounds and allows diamond adjustment while seated", async () => {
    const admin = await createTestIdentity(database, "guard-admin", 1_000);
    const target = await createTestIdentity(database, "guard-target", 100);
    await database.user.update({ data: { role: "ADMIN" }, where: { id: admin.userId } });

    const negative = await app.inject({
      headers: { cookie: admin.cookie, origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: { operationId: randomUUID(), reason: "negative balance guard", signedAmount: -101 },
      url: `/api/admin/users/${target.userId}/wallet-adjustments`,
    });
    expect(negative.statusCode).toBe(409);
    expect(negative.json().error.code).toBe("WALLET_INSUFFICIENT_BALANCE");

    const room = await database.room.create({
      data: {
        actionTimeSeconds: 30,
        bigBlind: 20,
        maximumBuyIn: 2_000,
        maxSeats: 2,
        minimumBuyIn: 400,
        name: "admin adjustment guard",
        ownerId: admin.userId,
        roomCode: "771122",
        smallBlind: 10,
      },
    });
    const game = await database.gameSession.create({
      data: { roomId: room.id, seatIndex: 0, status: "ACTIVE", totalBuyIn: 100, userId: target.userId },
    });
    await database.tableSeat.create({
      data: { gameSessionId: game.id, roomId: room.id, seatIndex: 0, stack: 100, userId: target.userId },
    });
    const seated = await app.inject({
      headers: { cookie: admin.cookie, origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: { operationId: randomUUID(), reason: "active table balance guard", signedAmount: 1 },
      url: `/api/admin/users/${target.userId}/wallet-adjustments`,
    });
    expect(seated.statusCode).toBe(200);
    expect(seated.json().data).toMatchObject({ balanceAfter: 101, balanceBefore: 100, signedAmount: 1 });
  });

  it("commits one adjustment under concurrent replay of the same operation", async () => {
    const admin = await createTestIdentity(database, "concurrent-admin", 1_000);
    const target = await createTestIdentity(database, "concurrent-target", 2_000);
    await database.user.update({ data: { role: "ADMIN" }, where: { id: admin.userId } });
    const operationId = randomUUID();
    const request = () => app.inject({
      headers: { cookie: admin.cookie, origin, "x-wepoker-request": "1" },
      method: "POST" as const,
      payload: { operationId, reason: "concurrent adjustment replay", signedAmount: 300 },
      url: `/api/admin/users/${target.userId}/wallet-adjustments`,
    });
    const [left, right] = await Promise.all([request(), request()]);
    expect([left.statusCode, right.statusCode]).toEqual([200, 200]);
    expect([left.json().data.replayed, right.json().data.replayed].sort()).toEqual([false, true]);
    expect(await database.wallet.findUniqueOrThrow({ where: { userId: target.userId } })).toMatchObject({ balance: 2_300 });
    expect(await database.walletLedgerEntry.count({ where: { type: "ADMIN_ADJUSTMENT", userId: target.userId } })).toBe(1);
    expect(await database.auditLog.count({ where: { operationId } })).toBe(1);
  });

  it("leases fixed robot accounts without overlap and refills their test diamonds", async () => {
    const admin = await createTestIdentity(database, "lease-admin", 1_000);
    await database.user.update({ data: { role: "ADMIN" }, where: { id: admin.userId } });
    for (let index = 1; index <= 9; index += 1) {
      const bot = await createTestIdentity(database, `lease-bot-${String(index)}`, 100);
      await database.user.update({
        data: { isTestBot: true, testBotOrdinal: index },
        where: { id: bot.userId },
      });
    }
    const leftLease = randomUUID();
    const rightLease = randomUUID();
    const claim = (leaseId: string) => app.inject({
      headers: { cookie: admin.cookie, origin, "x-wepoker-request": "1" },
      method: "POST" as const,
      payload: { count: 5, leaseId },
      url: "/api/admin/test-bots/claim",
    });
    const responses = await Promise.all([claim(leftLease), claim(rightLease)]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const success = responses.find((response) => response.statusCode === 200)!;
    const accounts = success.json().data.accounts as Array<{ id: string; testBotOrdinal: number }>;
    expect(accounts.map((account) => account.testBotOrdinal)).toEqual([1, 2, 3, 4, 5]);
    expect(await database.wallet.count({
      where: { balance: 2_000_000_000, userId: { in: accounts.map((account) => account.id) } },
    })).toBe(5);

    const release = await app.inject({
      headers: { cookie: admin.cookie, origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: { leaseId: success.json().data.leaseId },
      url: "/api/admin/test-bots/release",
    });
    expect(release.statusCode).toBe(200);
    expect(await database.user.count({ where: { testBotLeaseId: null } })).toBe(10);
  });

  it("deletes CLOSED room data before allowing permanent player deletion", async () => {
    const admin = await createTestIdentity(database, "delete-admin", 1_000);
    const target = await createTestIdentity(database, "delete-target", 2_000);
    await database.user.update({ data: { role: "ADMIN" }, where: { id: admin.userId } });
    const room = await database.room.create({
      data: {
        actionTimeSeconds: 30,
        bigBlind: 20,
        closedAt: new Date(),
        closeRequestedAt: new Date(),
        maximumBuyIn: 2_000,
        maxSeats: 2,
        minimumBuyIn: 400,
        name: "可删除测试房间",
        ownerId: admin.userId,
        roomCode: "889911",
        smallBlind: 10,
        status: "CLOSED",
      },
    });
    await database.roomMember.createMany({ data: [
      { role: "OWNER", roomId: room.id, userId: admin.userId },
      { role: "MEMBER", roomId: room.id, userId: target.userId },
    ] });
    const deletePayload = () => ({
      confirmation: "永久删除",
      operationId: randomUUID(),
      reason: "清除本轮管理员测试数据",
    });
    const blocked = await app.inject({
      headers: { cookie: admin.cookie, origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: deletePayload(),
      url: `/api/admin/users/${target.userId}/delete`,
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("USER_HAS_ROOM_DATA");

    const deletedRoom = await app.inject({
      headers: { cookie: admin.cookie, origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: deletePayload(),
      url: `/api/admin/rooms/${room.id}/delete`,
    });
    expect(deletedRoom.statusCode).toBe(200);
    expect(await database.room.findUnique({ where: { id: room.id } })).toBeNull();

    const deletedUser = await app.inject({
      headers: { cookie: admin.cookie, origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: deletePayload(),
      url: `/api/admin/users/${target.userId}/delete`,
    });
    expect(deletedUser.statusCode).toBe(200);
    expect(await database.user.findUnique({ where: { id: target.userId } })).toBeNull();
    expect(await database.auditLog.count({ where: { action: { in: ["ADMIN_ROOM_DATA_DELETED", "ADMIN_USER_DATA_DELETED"] } } })).toBe(2);
  });
});
