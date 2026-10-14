import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import { loadEnvironment } from "../../config/environment.js";
import type { DatabaseClient } from "../../db/client.js";
import { clearIntegrationDatabase, createIntegrationDatabase, createTestIdentity } from "../../integration/database.js";
import { createRoomLifecyclePersistence } from "../tables/persistence/room-lifecycle-persistence.js";
import { TableRuntimeManager } from "../tables/runtime/table-runtime-manager.js";

const origin = "http://localhost:5173";

describe("administrator safe room lifecycle controls", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: DatabaseClient;
  let adminCookie: string;
  let roomId: string;
  const runtimes = new TableRuntimeManager();

  beforeAll(async () => {
    database = createIntegrationDatabase();
    const roomLifecycle = createRoomLifecyclePersistence(database, runtimes);
    app = await buildApp({
      database,
      environment: loadEnvironment(),
      logger: false,
      onRoomUpdating: roomLifecycle.onRoomUpdating,
      rateLimit: false,
      runRoomMutation: roomLifecycle.runRoomMutation,
      runtimes,
    });
    await app.ready();
  });

  beforeEach(async () => {
    runtimes.close();
    await clearIntegrationDatabase(database);
    const admin = await createTestIdentity(database, "room-action-admin", 1_000);
    const owner = await createTestIdentity(database, "room-action-owner", 1_000);
    await database.user.update({ data: { role: "ADMIN" }, where: { id: admin.userId } });
    adminCookie = admin.cookie;
    const room = await database.room.create({
      data: {
        actionTimeSeconds: 30,
        bigBlind: 20,
        maximumBuyIn: 2_000,
        maxSeats: 2,
        minimumBuyIn: 400,
        name: "controlled room",
        ownerId: owner.userId,
        roomCode: "771144",
        smallBlind: 10,
      },
    });
    roomId = room.id;
    await database.roomMember.create({ data: { role: "OWNER", roomId, userId: owner.userId } });
  });

  afterAll(async () => {
    await app.close();
    await database.$disconnect();
  });

  it("pauses, resumes and safely closes through existing lifecycle semantics with audit", async () => {
    for (const action of ["pause", "resume", "close"] as const) {
      const payload = {
        operationId: randomUUID(),
        reason: `administrator ${action} regression`,
      };
      const response = await app.inject({
        headers: { cookie: adminCookie, origin, "x-wepoker-request": "1" },
        method: "POST",
        payload,
        url: `/api/admin/rooms/${roomId}/${action}`,
      });
      expect(response.statusCode, action).toBe(200);
      const stored = await database.room.findUniqueOrThrow({ where: { id: roomId } });
      if (action === "pause") expect(stored.nextHandPaused).toBe(true);
      if (action === "resume") expect(stored.nextHandPaused).toBe(false);
      if (action === "close") expect(stored.status).toBe("CLOSED");
    }
    const audits = await database.auditLog.findMany({ where: { roomId } });
    expect(audits.map((entry) => entry.action)).toEqual([
      "ADMIN_ROOM_PAUSE",
      "ADMIN_ROOM_RESUME",
      "ADMIN_ROOM_CLOSE",
    ]);
    expect(audits.every((entry) => entry.reason !== null)).toBe(true);
  });

  it("requires a reason and rejects ordinary users before room lookup", async () => {
    const ordinary = await createTestIdentity(database, "room-action-user", 1_000);
    const denied = await app.inject({
      headers: { cookie: ordinary.cookie, origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: { operationId: randomUUID(), reason: "ordinary user request" },
      url: "/api/admin/rooms/not-a-real-room/pause",
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("ADMIN_REQUIRED");

    const invalid = await app.inject({
      headers: { cookie: adminCookie, origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: { operationId: randomUUID(), reason: "short" },
      url: `/api/admin/rooms/${roomId}/pause`,
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("lets an administrator safely close and delete a recovery-error room", async () => {
    const player = await createTestIdentity(database, "recovery-room-player", 1_000);
    const session = await database.gameSession.create({
      data: { roomId, seatIndex: 0, totalBuyIn: 400, userId: player.userId },
    });
    await database.tableSeat.create({
      data: { gameSessionId: session.id, roomId, seatIndex: 0, stack: 380, userId: player.userId },
    });
    await database.tableSnapshot.create({
      data: {
        activeHandId: "legacy-corrupted-hand",
        activeHandNumber: 98,
        lastRecoveryError: "active-hand-seat-accounting",
        payload: {},
        recoveryStatus: "ERROR",
        roomId,
        runtimeStatus: "RECOVERY_ERROR",
        schemaVersion: 5,
        snapshotRevision: 12,
        stateVersion: 24,
      },
    });
    const room = await database.room.findUniqueOrThrow({ where: { id: roomId } });
    const runtime = await runtimes.getOrCreate({
      actionTimeSeconds: room.actionTimeSeconds,
      bigBlind: room.bigBlind,
      bombPotBlindMultiplier: room.bombPotBlindMultiplier,
      bombPotIntervalMinutes: room.bombPotIntervalMinutes,
      bombPotNextAt: room.bombPotNextAt,
      durationMinutes: room.durationMinutes,
      expiresAt: room.expiresAt,
      initialBuyIn: room.initialBuyIn,
      maximumBuyIn: room.maximumBuyIn,
      maxSeats: room.maxSeats,
      minimumBuyIn: room.minimumBuyIn,
      name: room.name,
      nextHandPaused: room.nextHandPaused,
      ownerId: room.ownerId,
      paidCardRevealCost: room.paidCardRevealCost,
      paidCardRevealEnabled: room.paidCardRevealEnabled,
      requiresManualStart: room.requiresManualStart,
      roomCode: room.roomCode,
      roomId: room.id,
      runItTwiceEnabled: room.runItTwiceEnabled,
      smallBlind: room.smallBlind,
      specialMode: room.specialMode,
      status: room.status,
      squidRoundGraceEndsAt: room.squidRoundGraceEndsAt,
      squidRoundNumber: room.squidRoundNumber,
      squidSettlementPending: room.squidSettlementPending,
      squidStake: room.squidStake,
      tableStartedAt: room.tableStartedAt,
    });
    runtime.hydrated = true;
    runtime.status = "RECOVERY_ERROR";
    runtime.snapshotRevision = 12;
    runtime.stateVersion = 24;
    await database.room.update({
      data: { closeRequestedAt: new Date(), status: "CLOSING" },
      where: { id: roomId },
    });

    const close = await app.inject({
      headers: { cookie: adminCookie, origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: { operationId: randomUUID(), reason: "close unrecoverable legacy room" },
      url: `/api/admin/rooms/${roomId}/close`,
    });
    expect(close.statusCode).toBe(200);
    expect(close.json().data.room.status).toBe("CLOSED");
    expect(await database.tableSeat.count({ where: { roomId } })).toBe(0);
    expect(await database.gameSession.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({
      status: "CLOSED",
      totalCashOut: 380,
    });
    expect(await database.tableSnapshot.findUniqueOrThrow({ where: { roomId } })).toMatchObject({
      activeHandId: null,
      activeHandNumber: null,
      lastRecoveryError: null,
      recoveryStatus: "READY",
      runtimeStatus: "CLOSED",
      snapshotRevision: 13,
      stateVersion: 25,
    });
    expect(runtime).toMatchObject({ currentHand: null, stateVersion: 25, status: "CLOSED" });
    expect(runtime.seats.size).toBe(0);

    const remove = await app.inject({
      headers: { cookie: adminCookie, origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: { confirmation: "永久删除", operationId: randomUUID(), reason: "remove closed legacy room data" },
      url: `/api/admin/rooms/${roomId}/delete`,
    });
    expect(remove.statusCode).toBe(200);
    expect(await database.room.findUnique({ where: { id: roomId } })).toBeNull();
  });
});
