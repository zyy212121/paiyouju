import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { loadEnvironment } from "../config/environment.js";
import type { DatabaseClient } from "../db/client.js";
import { CreateRoomInputSchema } from "../modules/rooms/room.schemas.js";
import { createRoomService } from "../modules/rooms/room.service.js";
import { verifyPassword } from "../security/passwords.js";
import { clearIntegrationDatabase, createIntegrationDatabase, createTestIdentity } from "./database.js";

const origin = "http://localhost:5173";
const roomRequestInput = {
  actionTimeSeconds: 30 as const,
  bigBlind: 20,
  durationMinutes: 60 as const,
  initialBuyIn: 2_000,
  maximumBuyIn: 2_000,
  maxSeats: 9,
  minimumBuyIn: 400,
  name: "周末牌局",
  password: "room-password",
  specialMode: "NORMAL" as const,
  squidStake: null,
};
const roomInput = CreateRoomInputSchema.parse(roomRequestInput);

describe("private rooms with PostgreSQL", () => {
  let database: DatabaseClient;

  beforeAll(() => {
    database = createIntegrationDatabase();
  });
  beforeEach(async () => clearIntegrationDatabase(database));
  afterAll(async () => database.$disconnect());

  it("creates Room and OWNER in one transaction and hashes its password", async () => {
    const owner = await createTestIdentity(database, "alice", 10_000);
    const createdAt = new Date("2026-08-25T00:00:00.000Z");
    const rooms = createRoomService(database, { clock: () => createdAt, roomCode: () => "000123" });
    const room = await rooms.createRoom(owner.userId, roomInput, "create-room:1");

    expect(room).toMatchObject({ durationMinutes: 60, expiresAt: new Date("2026-08-25T01:00:00.000Z"), paidCardRevealCost: 50, paidCardRevealEnabled: true, roomCode: "000123", memberRole: "OWNER", nextHandPaused: false, status: "OPEN" });
    expect(JSON.stringify(room)).not.toContain("passwordHash");
    const stored = await database.room.findUniqueOrThrow({ where: { roomCode: "000123" } });
    expect(stored).toMatchObject({ createdAt, durationMinutes: 60, expiresAt: new Date("2026-08-25T01:00:00.000Z"), paidCardRevealCost: 50, paidCardRevealEnabled: true });
    expect(stored.passwordHash).not.toBe(roomRequestInput.password);
    await expect(verifyPassword(stored.passwordHash ?? "", roomRequestInput.password)).resolves.toBe(true);
    expect(await database.roomMember.findUniqueOrThrow({ where: { roomId_userId: { roomId: stored.id, userId: owner.userId } } })).toMatchObject({ role: "OWNER" });
  });

  it("creates a short-deck room from stack limits and disables run-it-twice", async () => {
    const owner = await createTestIdentity(database, "short-deck-owner", 10_000);
    const app = await buildApp({ database, environment: loadEnvironment(), logger: false, rateLimit: false, roomCode: () => "360036" });
    const response = await app.inject({
      headers: { cookie: owner.cookie, "idempotency-key": "create-short-deck:1", origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: {
        actionTimeSeconds: 30,
        bigBlind: 20,
        durationMinutes: 60,
        maximumBuyIn: 2_000,
        maxSeats: 9,
        minimumBuyIn: 500,
        name: "短牌测试",
        runItTwiceEnabled: true,
        specialMode: "SHORT_DECK",
      },
      url: "/api/rooms",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      initialBuyIn: 500,
      maximumBuyIn: 2_000,
      minimumBuyIn: 500,
      runItTwiceEnabled: false,
      specialMode: "SHORT_DECK",
      squidStake: null,
    });
    expect(await database.room.findUniqueOrThrow({ where: { roomCode: "360036" } })).toMatchObject({
      initialBuyIn: 500,
      maximumBuyIn: 2_000,
      minimumBuyIn: 500,
      runItTwiceEnabled: false,
      specialMode: "SHORT_DECK",
    });
    await app.close();
  });

  it("creates a mutually exclusive bomb-pot room with a durable schedule configuration", async () => {
    const owner = await createTestIdentity(database, "bomb-pot-owner", 10_000);
    const app = await buildApp({ database, environment: loadEnvironment(), logger: false, rateLimit: false, roomCode: () => "360037" });
    const response = await app.inject({
      headers: { cookie: owner.cookie, "idempotency-key": "create-bomb-pot:1", origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: {
        actionTimeSeconds: 30,
        bigBlind: 20,
        bombPotBlindMultiplier: 3,
        bombPotIntervalMinutes: 1,
        durationMinutes: 60,
        initialBuyIn: 2_000,
        maxSeats: 9,
        name: "暴击测试",
        runItTwiceEnabled: true,
        specialMode: "BOMB_POT",
      },
      url: "/api/rooms",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      bombPotBlindMultiplier: 3,
      bombPotIntervalMinutes: 1,
      bombPotNextAt: null,
      runItTwiceEnabled: false,
      specialMode: "BOMB_POT",
    });
    expect(await database.room.findUniqueOrThrow({ where: { roomCode: "360037" } })).toMatchObject({
      bombPotBlindMultiplier: 3,
      bombPotIntervalMinutes: 1,
      bombPotNextAt: null,
      runItTwiceEnabled: false,
      specialMode: "BOMB_POT",
    });
    await app.close();
  });

  it("persists every public 10-to-45-second action-time tier", async () => {
    const owner = await createTestIdentity(database, "timer-owner", 10_000);
    let roomCode = 100_000;
    const rooms = createRoomService(database, { roomCode: () => String(roomCode += 1) });

    for (const actionTimeSeconds of [10, 15, 20, 25, 30, 35, 40, 45] as const) {
      const room = await rooms.createRoom(
        owner.userId,
        { ...roomInput, actionTimeSeconds, name: `行动时间 ${String(actionTimeSeconds)} 秒`, password: undefined },
        `create-room:action-time:${String(actionTimeSeconds)}`,
      );
      expect(room.actionTimeSeconds).toBe(actionTimeSeconds);
    }
  });

  it("stores null for no password and retries a one-time code collision", async () => {
    const owner = await createTestIdentity(database, "alice", 10_000);
    let calls = 0;
    const rooms = createRoomService(database, {
      roomCode: () => {
        calls += 1;
        return calls < 3 ? "111111" : "222222";
      },
    });
    await rooms.createRoom(owner.userId, { ...roomInput, password: undefined }, "create-room:first");
    const second = await rooms.createRoom(owner.userId, { ...roomInput, name: "第二间", password: undefined }, "create-room:second");
    expect(second.roomCode).toBe("222222");
    expect((await database.room.findUniqueOrThrow({ where: { id: second.id } })).passwordHash).toBeNull();
  });

  it("returns a stable error when code retries are exhausted", async () => {
    const owner = await createTestIdentity(database, "alice", 10_000);
    const rooms = createRoomService(database, { maxCodeAttempts: 2, roomCode: () => "111111" });
    await rooms.createRoom(owner.userId, roomInput, "create-room:first");
    await expect(rooms.createRoom(owner.userId, { ...roomInput, name: "第二间" }, "create-room:second")).rejects.toMatchObject({ code: "ROOM_CODE_EXHAUSTED" });
    expect(await database.room.count()).toBe(1);
    expect(await database.roomMember.count()).toBe(1);
  });

  it("replays create idempotently and detects changed payload", async () => {
    const owner = await createTestIdentity(database, "alice", 10_000);
    const rooms = createRoomService(database, { roomCode: () => "123456" });
    const first = await rooms.createRoom(owner.userId, roomInput, "create-room:same");
    const replay = await rooms.createRoom(owner.userId, roomInput, "create-room:same");
    expect(replay).toEqual(first);
    expect(await database.room.count()).toBe(1);
    await expect(rooms.createRoom(owner.userId, { ...roomInput, name: "更改名称" }, "create-room:same")).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("joins with code/password, is idempotent, and keeps denial private", async () => {
    const owner = await createTestIdentity(database, "alice", 10_000);
    const member = await createTestIdentity(database, "bob", 10_000);
    const outsider = await createTestIdentity(database, "charlie", 10_000);
    const rooms = createRoomService(database, { roomCode: () => "123456" });
    await rooms.createRoom(owner.userId, roomInput, "create-room:1");
    const joined = await rooms.joinRoom(member.userId, { password: roomInput.password, roomCode: "123456" });
    const replay = await rooms.joinRoom(member.userId, { password: roomInput.password, roomCode: "123456" });
    expect(joined).toEqual(replay);
    expect(joined.memberRole).toBe("MEMBER");
    expect(await database.roomMember.count()).toBe(2);

    const missing = rooms.joinRoom(outsider.userId, { password: roomInput.password, roomCode: "999999" });
    const wrong = rooms.joinRoom(outsider.userId, { password: "wrong-password", roomCode: "123456" });
    await expect(missing).rejects.toMatchObject({ code: "ROOM_JOIN_DENIED", message: "无法加入房间" });
    await expect(wrong).rejects.toMatchObject({ code: "ROOM_JOIN_DENIED", message: "无法加入房间" });
  });

  it("enforces member reads, owner controls and direct idempotent close", async () => {
    const owner = await createTestIdentity(database, "alice", 10_000);
    const member = await createTestIdentity(database, "bob", 10_000);
    const outsider = await createTestIdentity(database, "charlie", 10_000);
    const rooms = createRoomService(database, { roomCode: () => "123456" });
    const created = await rooms.createRoom(owner.userId, roomInput, "create-room:1");
    await rooms.joinRoom(member.userId, { password: roomInput.password, roomCode: "123456" });
    await expect(rooms.getRoom(outsider.userId, created.id)).rejects.toMatchObject({ code: "ROOM_NOT_FOUND" });
    expect((await rooms.listRooms(member.userId)).map((room) => room.id)).toEqual([created.id]);
    await expect(rooms.pauseRoom(member.userId, created.id)).rejects.toMatchObject({ code: "ROOM_OWNER_REQUIRED" });
    expect(await rooms.pauseRoom(owner.userId, created.id)).toMatchObject({ nextHandPaused: true });
    expect(await rooms.resumeRoom(owner.userId, created.id)).toMatchObject({ nextHandPaused: false });
    const closed = await rooms.closeRoom(owner.userId, created.id);
    expect(closed).toMatchObject({ status: "CLOSED" });
    expect((await rooms.closeRoom(owner.userId, created.id)).closedAt).toEqual(closed.closedAt);
    await expect(rooms.joinRoom(member.userId, { roomCode: "123456" })).resolves.toMatchObject({ memberRole: "MEMBER", status: "CLOSED" });
    await expect(rooms.pauseRoom(owner.userId, created.id)).rejects.toMatchObject({ code: "ROOM_NOT_OPEN" });
    await expect(rooms.joinRoom(outsider.userId, { password: roomInput.password, roomCode: "123456" })).rejects.toMatchObject({ code: "ROOM_JOIN_DENIED" });
    await expect(rooms.getRoom(member.userId, created.id)).resolves.toMatchObject({ status: "CLOSED" });
  });

  it("routes a room with a detached active stack through final closing", async () => {
    const owner = await createTestIdentity(database, "detached-close-owner", 10_000);
    const rooms = createRoomService(database, { roomCode: () => "123457" });
    const created = await rooms.createRoom(owner.userId, { ...roomInput, password: undefined }, "create-room:detached-close");
    await database.gameSession.create({
      data: {
        detachedStack: created.initialBuyIn,
        roomId: created.id,
        seatIndex: 0,
        totalBuyIn: created.initialBuyIn,
        userId: owner.userId,
      },
    });

    const closing = await rooms.closeRoom(owner.userId, created.id);

    expect(closing).toMatchObject({ closedAt: null, status: "CLOSING" });
    expect(await database.gameSession.count({ where: { roomId: created.id, status: "ACTIVE" } })).toBe(1);
  });

  it("serves authenticated room APIs without public discovery", async () => {
    const owner = await createTestIdentity(database, "alice", 10_000);
    const member = await createTestIdentity(database, "bob", 10_000);
    const app = await buildApp({ database, environment: loadEnvironment(), logger: false, rateLimit: false, roomCode: () => "654321" });
    const created = await app.inject({
      headers: { cookie: owner.cookie, "idempotency-key": "http-create:1", origin, "x-wepoker-request": "1" }, method: "POST", payload: roomRequestInput, url: "/api/rooms",
    });
    expect(created.statusCode).toBe(201);
    const roomId = created.json().data.id as string;
    expect((await app.inject({ headers: { cookie: member.cookie, origin, "x-wepoker-request": "1" }, method: "POST", payload: { password: roomInput.password, roomCode: "654321" }, url: "/api/rooms/join" })).statusCode).toBe(200);
    expect((await app.inject({ headers: { cookie: owner.cookie }, method: "GET", url: "/api/rooms" })).statusCode).toBe(200);
    expect((await app.inject({ headers: { cookie: member.cookie }, method: "GET", url: `/api/rooms/${roomId}` })).statusCode).toBe(200);
    const ranking = await app.inject({ headers: { cookie: member.cookie }, method: "GET", url: `/api/rooms/${roomId}/rankings` });
    expect(ranking.statusCode).toBe(200);
    expect(ranking.json().data).toMatchObject({ players: [], roomId, summary: { activePlayers: 0, handsPlayed: 0, totalBuyIn: 0, totalPot: 0 } });
    expect((await app.inject({ headers: { cookie: owner.cookie, origin, "x-wepoker-request": "1" }, method: "POST", url: `/api/rooms/${roomId}/pause` })).statusCode).toBe(200);
    expect((await app.inject({ headers: { cookie: owner.cookie, origin, "x-wepoker-request": "1" }, method: "POST", url: `/api/rooms/${roomId}/resume` })).statusCode).toBe(200);
    expect((await app.inject({ headers: { cookie: owner.cookie, origin, "x-wepoker-request": "1" }, method: "POST", url: `/api/rooms/${roomId}/close` })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/rooms" })).statusCode).toBe(401);
    await app.close();
  });

  it("ranks current and departed table players by profit with VPIP, win rate and public totals", async () => {
    const owner = await createTestIdentity(database, "alice", 10_000);
    const member = await createTestIdentity(database, "bob", 10_000);
    const outsider = await createTestIdentity(database, "charlie", 10_000);
    const rooms = createRoomService(database, { clock: () => new Date("2026-08-20T01:10:00.000Z"), roomCode: () => "232323" });
    const room = await rooms.createRoom(owner.userId, { ...roomInput, password: undefined }, "create-room:ranking");
    await rooms.joinRoom(member.userId, { roomCode: room.roomCode });
    const startedAt = new Date("2026-08-20T01:00:00.000Z");
    const ownerGame = await database.gameSession.create({ data: { roomId: room.id, seatIndex: 0, startedAt, status: "ACTIVE", totalBuyIn: 600, userId: owner.userId } });
    const memberGame = await database.gameSession.create({ data: { endedAt: new Date("2026-08-20T01:05:00.000Z"), roomId: room.id, seatIndex: 1, startedAt, status: "CLOSED", totalBuyIn: 400, totalCashOut: 370, userId: member.userId } });
    await database.tableSeat.create({ data: { gameSessionId: ownerGame.id, roomId: room.id, seatIndex: 0, stack: 630, userId: owner.userId } });

    for (const [index, values] of [
      { ownerAction: "CALL", ownerNet: 50, memberAction: "FOLD", memberNet: -50, pot: 100 },
      { ownerAction: "FOLD", ownerNet: -20, memberAction: "RAISE_TO", memberNet: 20, pot: 80 },
    ].entries()) {
      const current = values as { ownerAction: "CALL" | "FOLD"; ownerNet: number; memberAction: "FOLD" | "RAISE_TO"; memberNet: number; pot: number };
      const handId = `72000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const at = new Date(startedAt.getTime() + index * 60_000);
      await database.handRecord.create({ data: { bigBlindAmount: 20, bigBlindSeat: 1, board: [], buttonSeat: 0, finishReason: "FOLD_TO_WIN", finishedAt: new Date(at.getTime() + 30_000), handNumber: index + 1, id: handId, roomId: room.id, smallBlindAmount: 10, smallBlindSeat: 0, startedAt: at } });
      await database.handPlayerRecord.createMany({ data: [
        { allIn: false, committed: 20, endingStack: 400 + current.ownerNet, folded: current.ownerAction === "FOLD", gameSessionId: ownerGame.id, handId, holeCards: ["As", "Kd"], holeCardsPublic: false, netResult: current.ownerNet, roomId: room.id, seatIndex: 0, startingStack: 400, userId: owner.userId },
        { allIn: false, committed: 20, endingStack: 400 + current.memberNet, folded: current.memberAction === "FOLD", gameSessionId: memberGame.id, handId, holeCards: ["Qc", "Jh"], holeCardsPublic: false, netResult: current.memberNet, roomId: room.id, seatIndex: 1, startingStack: 400, userId: member.userId },
      ] });
      await database.handActionRecord.createMany({ data: [
        { actionType: current.ownerAction, amount: current.ownerAction === "CALL" ? 20 : null, automatic: false, handId, raiseTo: null, seatIndex: 0, sequence: 1, stateVersion: 2, street: "PREFLOP", userId: owner.userId },
        { actionType: current.memberAction, amount: null, automatic: false, handId, raiseTo: current.memberAction === "RAISE_TO" ? 60 : null, seatIndex: 1, sequence: 2, stateVersion: 3, street: "PREFLOP", userId: member.userId },
      ] });
      await database.handPotRecord.create({ data: { amount: current.pot, contributors: [owner.userId, member.userId], eligiblePlayers: [owner.userId, member.userId], handId, oddChipRecipients: [], potIndex: 0, winners: current.ownerNet > 0 ? [owner.userId] : [member.userId] } });
    }

    await expect(rooms.getRankings(outsider.userId, room.id)).rejects.toMatchObject({ code: "ROOM_NOT_FOUND" });
    expect(await rooms.getRankings(owner.userId, room.id)).toEqual({
      players: [
        { handsPlayed: 2, netResult: 30, nickname: "alice", seatIndex: 0, seated: true, totalBuyIn: 600, userId: owner.userId, voluntarilyEnteredHands: 1, vpip: 50, winningHands: 1, winRate: 50 },
        { handsPlayed: 2, netResult: -30, nickname: "bob", seatIndex: null, seated: false, totalBuyIn: 400, userId: member.userId, voluntarilyEnteredHands: 1, vpip: 50, winningHands: 1, winRate: 50 },
      ],
      roomId: room.id,
      summary: { activePlayers: 1, averagePot: 90, departedPlayers: 1, elapsedSeconds: 600, handsPlayed: 2, totalBuyIn: 1_000, totalPot: 180 },
    });
  });

  it("counts a legacy player's first seat grant once while preserving later voluntary top-ups", async () => {
    const owner = await createTestIdentity(database, "legacy-ranking-owner", 10_000);
    const rooms = createRoomService(database, { roomCode: () => "242424" });
    const room = await rooms.createRoom(owner.userId, { ...roomInput, password: undefined }, "create-room:legacy-ranking");
    const firstSession = await database.gameSession.create({
      data: {
        endedAt: new Date("2026-08-20T01:05:00.000Z"),
        roomId: room.id,
        seatIndex: 0,
        startedAt: new Date("2026-08-20T01:00:00.000Z"),
        status: "CLOSED",
        totalBuyIn: 2_500,
        totalCashOut: 2_500,
        userId: owner.userId,
      },
    });
    const secondSession = await database.gameSession.create({
      data: {
        detachedStack: 2_300,
        roomId: room.id,
        seatIndex: 1,
        startedAt: new Date("2026-08-20T01:06:00.000Z"),
        status: "ACTIVE",
        totalBuyIn: 2_300,
        userId: owner.userId,
      },
    });
    await database.tableStackLedgerEntry.createMany({
      data: [
        { gameSessionId: firstSession.id, idempotencyKey: "legacy-ranking:first:seat", requestFingerprint: "legacy-ranking:first:seat", roomId: room.id, sequence: 1, signedAmount: 2_000, stackAfter: 2_000, stackBefore: 0, type: "BUY_IN", userId: owner.userId },
        { gameSessionId: firstSession.id, idempotencyKey: "legacy-ranking:first:top-up", requestFingerprint: "legacy-ranking:first:top-up", roomId: room.id, sequence: 2, signedAmount: 500, stackAfter: 2_500, stackBefore: 2_000, type: "BUY_IN", userId: owner.userId },
        { gameSessionId: secondSession.id, idempotencyKey: "legacy-ranking:second:seat", requestFingerprint: "legacy-ranking:second:seat", roomId: room.id, sequence: 1, signedAmount: 2_000, stackAfter: 2_000, stackBefore: 0, type: "BUY_IN", userId: owner.userId },
        { gameSessionId: secondSession.id, idempotencyKey: "legacy-ranking:second:top-up", requestFingerprint: "legacy-ranking:second:top-up", roomId: room.id, sequence: 2, signedAmount: 300, stackAfter: 2_300, stackBefore: 2_000, type: "BUY_IN", userId: owner.userId },
      ],
    });

    const ranking = await rooms.getRankings(owner.userId, room.id);

    expect(ranking.players).toEqual([
      expect.objectContaining({ totalBuyIn: 2_800, userId: owner.userId }),
    ]);
    expect(ranking.summary.totalBuyIn).toBe(2_800);
  });

  it("uses Room.ownerId as the authoritative owner permission", async () => {
    const owner = await createTestIdentity(database, "alice", 10_000);
    const member = await createTestIdentity(database, "bob", 10_000);
    const rooms = createRoomService(database, { roomCode: () => "123456" });
    const created = await rooms.createRoom(owner.userId, roomInput, "create-room:owner-authority");
    await rooms.joinRoom(member.userId, { password: roomInput.password, roomCode: "123456" });
    await database.roomMember.update({
      data: { role: "OWNER" },
      where: { roomId_userId: { roomId: created.id, userId: member.userId } },
    });

    await expect(rooms.pauseRoom(member.userId, created.id)).rejects.toMatchObject({
      code: "ROOM_OWNER_REQUIRED",
    });
  });

  it("separates active and closed lists, then soft-archives without deleting room membership", async () => {
    const owner = await createTestIdentity(database, "alice", 10_000);
    const member = await createTestIdentity(database, "bob", 10_000);
    const rooms = createRoomService(database, { roomCode: () => "123456" });
    const created = await rooms.createRoom(owner.userId, roomInput, "create-room:archive");
    await rooms.joinRoom(member.userId, { password: roomInput.password, roomCode: created.roomCode });
    await rooms.closeRoom(owner.userId, created.id);

    expect(await rooms.listRooms(owner.userId)).toEqual([]);
    expect((await rooms.listClosedRooms(owner.userId, { limit: 25 })).items.map((room) => room.id)).toEqual([created.id]);
    await expect(rooms.archiveRoom(member.userId, created.id, { operationId: "90000000-0000-4000-8000-000000000001" })).rejects.toMatchObject({ code: "ROOM_OWNER_REQUIRED" });

    const input = { operationId: "90000000-0000-4000-8000-000000000002" };
    const archived = await rooms.archiveRoom(owner.userId, created.id, input);
    const replay = await rooms.archiveRoom(owner.userId, created.id, input);
    expect(replay).toEqual(archived);
    expect(archived).toMatchObject({ alreadyArchived: false, roomId: created.id });
    expect((await rooms.listClosedRooms(owner.userId, { limit: 25 })).items).toEqual([]);
    expect(await database.room.count({ where: { id: created.id } })).toBe(1);
    expect(await database.roomMember.count({ where: { roomId: created.id } })).toBe(2);
    expect(await database.room.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ archivedByUserId: owner.userId, status: "CLOSED" });
  });

  it("rejects unsafe room archival and serializes concurrent archive operations", async () => {
    const owner = await createTestIdentity(database, "alice", 10_000);
    const rooms = createRoomService(database, { roomCode: () => "123456" });
    const created = await rooms.createRoom(owner.userId, roomInput, "create-room:archive-race");
    await expect(rooms.archiveRoom(owner.userId, created.id, { operationId: "90000000-0000-4000-8000-000000000003" })).rejects.toMatchObject({ code: "ROOM_ARCHIVE_NOT_SAFE" });
    await rooms.closeRoom(owner.userId, created.id);

    const environment = loadEnvironment();
    const { createDatabaseClient } = await import("../db/client.js");
    const second = createDatabaseClient(environment.DATABASE_URL, environment.DATABASE_POOL_MAX);
    try {
      const [left, right] = await Promise.all([
        createRoomService(database).archiveRoom(owner.userId, created.id, { operationId: "90000000-0000-4000-8000-000000000004" }),
        createRoomService(second).archiveRoom(owner.userId, created.id, { operationId: "90000000-0000-4000-8000-000000000005" }),
      ]);
      expect([left.alreadyArchived, right.alreadyArchived].sort()).toEqual([false, true]);
      expect(await database.room.count({ where: { id: created.id } })).toBe(1);
      expect(await database.requestIdempotency.count({ where: { scope: "ROOM_ARCHIVE" } })).toBe(2);
    } finally { await second.$disconnect(); }
  });

  it("archives a relationally closed room even when its obsolete recovery snapshot is degraded", async () => {
    const owner = await createTestIdentity(database, "legacy-archive-owner", 10_000);
    const rooms = createRoomService(database, { roomCode: () => "456789" });
    const created = await rooms.createRoom(owner.userId, roomInput, "create-room:legacy-archive");
    await rooms.closeRoom(owner.userId, created.id);
    await database.tableSnapshot.create({
      data: {
        lastRecoveryError: "payload-schema:room.durationMinutes",
        payload: { legacy: true },
        recoveryStatus: "ERROR",
        roomId: created.id,
        runtimeStatus: "RECOVERY_ERROR",
        schemaVersion: 2,
        snapshotRevision: 3,
        stateVersion: 3,
      },
    });

    await expect(rooms.archiveRoom(owner.userId, created.id, { operationId: "90000000-0000-4000-8000-000000000006" })).resolves.toMatchObject({
      alreadyArchived: false,
      roomId: created.id,
    });
  });

  it("binds closed-room cursors to the requesting user", async () => {
    const owner = await createTestIdentity(database, "alice", 10_000);
    const member = await createTestIdentity(database, "bob", 10_000);
    const rooms = createRoomService(database, { roomCode: () => "123456" });
    const first = await rooms.createRoom(owner.userId, roomInput, "create-room:cursor-1");
    await rooms.joinRoom(member.userId, { password: roomInput.password, roomCode: first.roomCode });
    await rooms.closeRoom(owner.userId, first.id);
    const secondRooms = createRoomService(database, { roomCode: () => "654321" });
    const second = await secondRooms.createRoom(owner.userId, { ...roomInput, name: "第二间" }, "create-room:cursor-2");
    await secondRooms.joinRoom(member.userId, { password: roomInput.password, roomCode: second.roomCode });
    await secondRooms.closeRoom(owner.userId, second.id);
    const page = await rooms.listClosedRooms(owner.userId, { limit: 1 });
    expect(page.nextCursor).toEqual(expect.any(String));
    await expect(rooms.listClosedRooms(member.userId, { cursor: page.nextCursor!, limit: 1 })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });
});
