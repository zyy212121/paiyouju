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

describe("Step 7 administrator read models", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: DatabaseClient;
  let cookie: string;
  let roomId: string;
  let gameSessionId: string;
  let handId: string;

  beforeAll(async () => {
    database = createIntegrationDatabase();
    app = await buildApp({
      database,
      environment: loadEnvironment(),
      eventLoopDelay: () => ({ maximumMs: 4, meanMs: 1.5, p50Ms: 1, p95Ms: 2, p99Ms: 3 }),
      logger: false,
      rateLimit: false,
    });
    await app.ready();
  });

  beforeEach(async () => {
    await clearIntegrationDatabase(database);
    const now = Date.now();
    const admin = await createTestIdentity(database, "query-admin", 1_000);
    const player = await createTestIdentity(database, "query-player", 2_000);
    await database.user.update({ data: { role: "ADMIN" }, where: { id: admin.userId } });
    cookie = admin.cookie;
    const room = await database.room.create({
      data: {
        actionTimeSeconds: 30,
        bigBlind: 20,
        maximumBuyIn: 2_000,
        maxSeats: 2,
        minimumBuyIn: 400,
        name: "admin query room",
        ownerId: admin.userId,
        roomCode: "771133",
        smallBlind: 10,
      },
    });
    roomId = room.id;
    await database.roomMember.createMany({
      data: [
        { role: "OWNER", roomId, userId: admin.userId },
        { role: "MEMBER", roomId, userId: player.userId },
      ],
    });
    const game = await database.gameSession.create({
      data: {
        endedAt: new Date(now),
        roomId,
        seatIndex: 1,
        startedAt: new Date(now - 10 * 60 * 1_000),
        status: "CLOSED",
        totalBuyIn: 400,
        totalCashOut: 420,
        userId: player.userId,
      },
    });
    gameSessionId = game.id;
    handId = "step7-admin-finished-hand";
    await database.handRecord.create({
      data: {
        bigBlindAmount: 20,
        bigBlindSeat: 1,
        board: ["As", "Kd", "Qc", "Jh", "9s"],
        buttonSeat: 0,
        finishReason: "SHOWDOWN",
        finishedAt: new Date(now - 8 * 60 * 1_000),
        fullBoard: ["As", "Kd", "Qc", "Jh", "9s"],
        handNumber: 1,
        id: handId,
        remainingDeck: ["2c", "3c"],
        roomId,
        smallBlindAmount: 10,
        smallBlindSeat: 0,
        startedAt: new Date(now - 9 * 60 * 1_000),
      },
    });
    await database.handPlayerRecord.create({
      data: {
        allIn: false,
        committed: 20,
        endingStack: 420,
        folded: false,
        gameSessionId,
        handId,
        holeCards: ["Ah", "Ad"],
        holeCardsPublic: true,
        holeCardsPublicReason: "SHOWDOWN",
        netResult: 20,
        roomId,
        seatIndex: 1,
        startingStack: 400,
        userId: player.userId,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await database.$disconnect();
  });

  it("serves every required read route with safe, no-store envelopes", async () => {
    const routes = [
      "/api/admin/rooms",
      `/api/admin/rooms/${roomId}`,
      "/api/admin/tables",
      "/api/admin/games",
      `/api/admin/games/${gameSessionId}`,
      "/api/admin/hands",
      "/api/admin/wallet-ledger",
      "/api/admin/point-actions",
      "/api/admin/paid-reveals",
      "/api/admin/hypothetical-runouts",
      "/api/admin/audit-logs",
      "/api/admin/recovery",
      "/api/admin/system",
    ];
    for (const url of routes) {
      const response = await app.inject({ headers: { cookie, origin }, method: "GET", url });
      expect(response.statusCode, url).toBe(200);
      expect(response.headers["cache-control"], url).toContain("no-store");
      expect(response.body, url).not.toMatch(/passwordHash|tokenHash|remainingDeck|snapshot.*payload/i);
    }
  });

  it("reports event-loop and PostgreSQL connection metrics for release load tests", async () => {
    const response = await app.inject({ headers: { cookie, origin }, method: "GET", url: "/api/admin/system" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      actionCacheSize: expect.any(Number),
      activeRuntimeTimers: expect.any(Number),
      completedHands: 1,
      databaseConnections: {
        active: expect.any(Number),
        idle: expect.any(Number),
        total: expect.any(Number),
      },
      eventLoopDelayMs: { maximumMs: 4, meanMs: 1.5, p50Ms: 1, p95Ms: 2, p99Ms: 3 },
    });
    expect(response.json().data.databaseConnections.total).toBeGreaterThanOrEqual(1);
  });

  it("validates an action-time extension against the settled hand referenced by ledger metadata", async () => {
    const player = await database.handPlayerRecord.findFirstOrThrow({ where: { handId } });
    const wallet = await database.wallet.findUniqueOrThrow({ where: { userId: player.userId } });
    await database.$transaction([
      database.wallet.update({
        data: { balance: wallet.balance - 10, version: wallet.version + 1 },
        where: { id: wallet.id },
      }),
      database.walletLedgerEntry.create({
        data: {
          balanceAfter: wallet.balance - 10,
          balanceBefore: wallet.balance,
          idempotencyKey: "admin-query-action-time-extension",
          metadata: { addedSeconds: 15, handId },
          relatedGameSessionId: gameSessionId,
          relatedRoomId: roomId,
          requestFingerprint: "admin-query-action-time-extension",
          sequence: wallet.version + 1,
          signedAmount: -10,
          type: "ACTION_TIME_EXTENSION",
          userId: player.userId,
          walletId: wallet.id,
        },
      }),
    ]);
    const walletAfterExtension = await database.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    await database.$transaction([
      database.wallet.update({
        data: { balance: walletAfterExtension.balance - 10, version: walletAfterExtension.version + 1 },
        where: { id: wallet.id },
      }),
      database.walletLedgerEntry.create({
        data: {
          balanceAfter: walletAfterExtension.balance - 10,
          balanceBefore: walletAfterExtension.balance,
          idempotencyKey: `hand-entry:${handId}:${player.userId}`,
          metadata: { handId },
          relatedGameSessionId: gameSessionId,
          relatedHandId: handId,
          relatedRoomId: roomId,
          requestFingerprint: `hand-entry:${handId}:${player.userId}:10`,
          sequence: walletAfterExtension.version + 1,
          signedAmount: -10,
          type: "HAND_ENTRY_FEE",
          userId: player.userId,
          walletId: wallet.id,
        },
      }),
    ]);

    const response = await app.inject({ headers: { cookie, origin }, method: "GET", url: "/api/admin/point-actions" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toContainEqual(expect.objectContaining({
      actionType: "ACTION_TIME_EXTENSION",
      bigBlind: 20,
      cost: 10,
      expectedCost: 10,
      handId,
      validationStatus: "VALID",
    }));
    expect(response.json().data.items).toContainEqual(expect.objectContaining({
      actionType: "HAND_ENTRY_FEE",
      cost: 10,
      expectedCost: 10,
      handId,
      validationStatus: "VALID",
    }));
  });

  it("shows full cards only for a completed hand and writes a card-free audit record", async () => {
    const response = await app.inject({
      headers: { cookie, origin, "user-agent": "Step7 admin audit browser" },
      method: "GET",
      url: `/api/admin/hands/${handId}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.players[0].holeCards).toEqual(["Ah", "Ad"]);
    expect(response.body).not.toContain("remainingDeck");

    const audit = await database.auditLog.findFirstOrThrow({
      where: { action: "ADMIN_VIEW_FULL_HAND", handId },
    });
    expect(audit.metadata).toMatchObject({ handNumber: 1 });
    expect(JSON.stringify(audit.metadata)).not.toMatch(/"(?:Ah|Ad|As|Kd|Qc|Jh|9s)"/);
  });
});
