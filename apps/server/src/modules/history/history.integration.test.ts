import { Writable } from "node:stream";
import { io, type Socket } from "socket.io-client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import { loadEnvironment } from "../../config/environment.js";
import type { DatabaseClient } from "../../db/client.js";
import { clearIntegrationDatabase, createIntegrationDatabase, createTestIdentity } from "../../integration/database.js";
import { attachRealtimeTransport } from "../../realtime.js";
import { projectTableStateForUser } from "../tables/runtime/project-table-state.js";
import { TableRuntimeManager } from "../tables/runtime/table-runtime-manager.js";
import { createPaidCardRevealService } from "./paid-card-reveal.service.js";
import { createPaidHandRevealService } from "./paid-hand-reveal.service.js";
import { createHypotheticalRunoutService } from "./hypothetical-runout.service.js";

const origin = "http://localhost:5173";
const handId = "60000000-0000-4000-8000-000000000001";
const operation = (suffix: string) => `61000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

function connect(url: string, cookie: string): Socket {
  return io(url, {
    autoConnect: false,
    extraHeaders: { Cookie: cookie, Origin: origin },
    forceNew: true,
    transports: ["websocket"],
  });
}

function waitForConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
    socket.connect();
  });
}

async function historyFixture(database: DatabaseClient) {
  const alice = await createTestIdentity(database, "alice", 1_000);
  const bob = await createTestIdentity(database, "bob", 1_000);
  const outsider = await createTestIdentity(database, "charlie", 1_000);
  const room = await database.room.create({
    data: {
      actionTimeSeconds: 30,
      bigBlind: 20,
      maximumBuyIn: 2_000,
      maxSeats: 2,
      minimumBuyIn: 400,
      name: "历史牌桌",
      ownerId: alice.userId,
      paidCardRevealCost: 10,
      paidCardRevealEnabled: true,
      roomCode: "606060",
      smallBlind: 10,
    },
  });
  await database.roomMember.createMany({ data: [
    { role: "OWNER", roomId: room.id, userId: alice.userId },
    { role: "MEMBER", roomId: room.id, userId: bob.userId },
  ] });
  const startedAt = new Date("2026-08-20T01:00:00.000Z");
  const finishedAt = new Date("2026-08-20T01:01:00.000Z");
  const aliceGame = await database.gameSession.create({ data: { endedAt: finishedAt, roomId: room.id, seatIndex: 0, startedAt, status: "CLOSED", totalBuyIn: 400, totalCashOut: 390, userId: alice.userId } });
  const bobGame = await database.gameSession.create({ data: { endedAt: finishedAt, roomId: room.id, seatIndex: 1, startedAt, status: "CLOSED", totalBuyIn: 400, totalCashOut: 410, userId: bob.userId } });
  await database.handRecord.create({ data: {
    bigBlindAmount: 20,
    bigBlindSeat: 1,
    board: [],
    buttonSeat: 0,
    finishReason: "FOLD_TO_WIN",
    finishedAt,
    handNumber: 1,
    id: handId,
    paidCardRevealCost: 10,
    paidCardRevealEnabled: true,
    roomId: room.id,
    smallBlindAmount: 10,
    smallBlindSeat: 0,
    startedAt,
  } });
  await database.handPlayerRecord.createMany({ data: [
    { allIn: false, committed: 10, endingStack: 390, folded: true, gameSessionId: aliceGame.id, handId, holeCards: ["As", "Kd"], holeCardsPublic: false, netResult: -10, roomId: room.id, seatIndex: 0, startingStack: 400, userId: alice.userId },
    { allIn: false, committed: 20, endingStack: 410, folded: false, gameSessionId: bobGame.id, handId, holeCards: ["Qc", "Jh"], holeCardsPublic: false, netResult: 10, roomId: room.id, seatIndex: 1, startingStack: 400, userId: bob.userId },
  ] });
  await database.handActionRecord.create({ data: { actionType: "FOLD", amount: null, automatic: false, clientActionId: operation("91"), handId, raiseTo: null, seatIndex: 0, sequence: 1, stateVersion: 2, street: "PREFLOP", userId: alice.userId } });
  await database.handPotRecord.create({ data: { amount: 30, contributors: [alice.userId, bob.userId], eligiblePlayers: [bob.userId], handId, oddChipRecipients: [], potIndex: 0, winners: [bob.userId] } });
  return { alice, aliceGame, bob, bobGame, outsider, room };
}

describe("Step 6 history, profile and paid reveal APIs", () => {
  let database: DatabaseClient;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let runtimes: TableRuntimeManager;

  beforeAll(async () => {
    database = createIntegrationDatabase();
    runtimes = new TableRuntimeManager();
    app = await buildApp({ database, environment: loadEnvironment(), logger: false, rateLimit: false, runtimes });
    await app.ready();
  });
  beforeEach(async () => clearIntegrationDatabase(database));
  afterAll(async () => { await app.close(); runtimes.close(); await database.$disconnect(); });

  it("returns owner-scoped games/hands and never serializes an opponent's hidden cards", async () => {
    const fixture = await historyFixture(database);
    const games = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: "/api/games?limit=1" });
    expect(games.statusCode).toBe(200);
    expect(games.headers["cache-control"]).toBe("no-store, max-age=0");
    expect(games.json().data.items[0]).toMatchObject({ netResult: -10, status: "CLOSED" });

    const hands = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: "/api/hands?limit=1&result=loss" });
    expect(hands.statusCode).toBe(200);
    expect(hands.json().data.items[0]).toMatchObject({ handId, netResult: -10, wonAnyPot: false });

    const detail = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: `/api/hands/${handId}` });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.body).toContain("As");
    expect(detail.body).not.toContain("Qc");
    expect(detail.body).not.toContain("Jh");
    expect(detail.json().data.settlement).toEqual({
      totalCommitted: 30,
      totalPot: 30,
      uncalledReturnTotal: 0,
      winnerUserIds: [fixture.bob.userId],
    });
    expect(detail.json().data.players.find((player: { userId: string }) => player.userId === fixture.alice.userId)).toMatchObject({ handLabel: "高牌" });
    expect(detail.json().data.players.find((player: { userId: string }) => player.userId === fixture.bob.userId)).toMatchObject({ handLabel: null, holeCards: null, holeCardsVisibility: "HIDDEN" });

    const denied = await app.inject({ headers: { cookie: fixture.outsider.cookie }, method: "GET", url: `/api/hands/${handId}` });
    expect(denied.statusCode).toBe(404);
    expect(denied.body).not.toContain("Qc");
  });

  it("projects one run-it-twice hand as two integer-preserving history branches", async () => {
    const fixture = await historyFixture(database);
    const secondHandId = "60000000-0000-4000-8000-000000000099";
    const startedAt = new Date("2026-08-20T02:00:00.000Z");
    const finishedAt = new Date("2026-08-20T02:01:00.000Z");
    const contributors = [fixture.alice.userId, fixture.bob.userId];
    await database.handRecord.create({ data: {
      bigBlindAmount: 20, bigBlindSeat: 1, board: ["2c", "3d", "4h", "5s", "6c"], buttonSeat: 0,
      finishReason: "SHOWDOWN", finishedAt, fullBoard: ["2c", "3d", "4h", "5s", "6c"], handNumber: 2,
      id: secondHandId, paidCardRevealCost: 10, paidCardRevealEnabled: true, roomId: fixture.room.id,
      runoutCount: 2, runoutVotes: { [fixture.alice.userId]: "TWICE", [fixture.bob.userId]: "TWICE" },
      smallBlindAmount: 10, smallBlindSeat: 0, startedAt,
    } });
    await database.handPlayerRecord.createMany({ data: [
      { allIn: true, committed: 31, endingStack: 400, folded: false, gameSessionId: fixture.aliceGame.id, handId: secondHandId, holeCards: ["As", "Kd"], holeCardsPublic: true, holeCardsPublicReason: "SHOWDOWN", netResult: 0, roomId: fixture.room.id, seatIndex: 0, startingStack: 400, userId: fixture.alice.userId },
      { allIn: true, committed: 30, endingStack: 400, folded: false, gameSessionId: fixture.bobGame.id, handId: secondHandId, holeCards: ["Qc", "Jh"], holeCardsPublic: true, holeCardsPublicReason: "SHOWDOWN", netResult: 0, roomId: fixture.room.id, seatIndex: 1, startingStack: 400, userId: fixture.bob.userId },
    ] });
    await database.handActionRecord.createMany({ data: [
      { actionType: "ALL_IN", amount: 31, automatic: false, clientActionId: operation("981"), handId: secondHandId, raiseTo: null, seatIndex: 0, sequence: 1, stateVersion: 2, street: "PREFLOP", userId: fixture.alice.userId },
      { actionType: "CALL", amount: 30, automatic: false, clientActionId: operation("982"), handId: secondHandId, raiseTo: null, seatIndex: 1, sequence: 2, stateVersion: 3, street: "PREFLOP", userId: fixture.bob.userId },
    ] });
    await database.handPotRecord.create({ data: { amount: 61, contributors, eligiblePlayers: contributors, handId: secondHandId, oddChipRecipients: [], potIndex: 0, winners: contributors } });
    await database.handRunoutRecord.create({ data: { board: ["2c", "3d", "4h", "5s", "6c"], handId: secondHandId, runoutIndex: 1 } });
    await database.handRunoutRecord.create({ data: { board: ["2c", "3d", "4h", "7s", "8c"], handId: secondHandId, runoutIndex: 2 } });
    await database.handRunoutPotRecord.createMany({ data: [
      { amount: 31, contributors, eligiblePlayers: contributors, handId: secondHandId, oddChipRecipients: [], potIndex: 0, runoutIndex: 1, winners: [fixture.alice.userId] },
      { amount: 30, contributors, eligiblePlayers: contributors, handId: secondHandId, oddChipRecipients: [], potIndex: 0, runoutIndex: 2, winners: [fixture.bob.userId] },
    ] });

    const list = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: `/api/hands?limit=10&roomId=${fixture.room.id}` });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().data.items.slice(0, 2)).toMatchObject([
      { displayHandNumber: "2-1", netResult: 15, runoutIndex: 1 },
      { displayHandNumber: "2-2", netResult: -15, runoutIndex: 2 },
    ]);
    const first = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: `/api/hands/${secondHandId}?runoutIndex=1` });
    const second = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: `/api/hands/${secondHandId}?runoutIndex=2` });
    expect(first.json().data).toMatchObject({ displayHandNumber: "2-1", ownResult: 15, runoutIndex: 1, settlement: { totalCommitted: 31, totalPot: 31 } });
    expect(second.json().data).toMatchObject({ displayHandNumber: "2-2", ownResult: -15, runoutIndex: 2, settlement: { totalCommitted: 30, totalPot: 30 } });
    expect(first.json().data.actions.map((event: { amount: number | null }) => event.amount)).toEqual([16, 15]);
    expect(second.json().data.actions.map((event: { amount: number | null }) => event.amount)).toEqual([15, 15]);
    const hypothetical = await app.inject({
      headers: { cookie: fixture.alice.cookie, origin, "x-wepoker-request": "1" }, method: "POST",
      payload: { operationId: operation("983") }, url: `/api/hands/${secondHandId}/hypothetical-runout`,
    });
    expect(hypothetical.statusCode).toBe(409);
    expect(hypothetical.json().error.code).toBe("HYPOTHETICAL_RUNOUT_NOT_AVAILABLE");
  });

  it("lets a room spectator list and read public history and purchase both room history features", async () => {
    const fixture = await historyFixture(database);
    await database.roomMember.create({ data: { role: "MEMBER", roomId: fixture.room.id, userId: fixture.outsider.userId } });

    const list = await app.inject({
      headers: { cookie: fixture.outsider.cookie },
      method: "GET",
      url: `/api/hands?limit=10&roomId=${encodeURIComponent(fixture.room.id)}`,
    });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().data.items).toEqual([
      expect.objectContaining({ handId, netResult: null, ownHoleCards: null, seatIndex: null, viewerParticipated: false }),
    ]);

    const publicDetail = await app.inject({ headers: { cookie: fixture.outsider.cookie }, method: "GET", url: `/api/hands/${handId}` });
    expect(publicDetail.statusCode, publicDetail.body).toBe(200);
    expect(publicDetail.json().data.ownResult).toBeNull();
    expect(publicDetail.body).not.toMatch(/As|Kd|Qc|Jh/u);

    const reveal = await app.inject({
      headers: { cookie: fixture.outsider.cookie, origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: { operationId: operation("301") },
      url: `/api/hands/${handId}/paid-hand-reveal`,
    });
    expect(reveal.statusCode, reveal.body).toBe(201);
    expect(reveal.json().data).toMatchObject({ alreadyOwned: false, revealedPlayerCount: 2, walletBalance: 990 });

    const purchasedDetail = await app.inject({ headers: { cookie: fixture.outsider.cookie }, method: "GET", url: `/api/hands/${handId}` });
    expect(purchasedDetail.body).toMatch(/As/u);
    expect(purchasedDetail.body).toMatch(/Qc/u);

    const runout = await app.inject({
      headers: { cookie: fixture.outsider.cookie, origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: { operationId: operation("302") },
      url: `/api/hands/${handId}/hypothetical-runout`,
    });
    expect(runout.statusCode, runout.body).toBe(201);
    expect(runout.json().data.runout.simulatedBoard).toHaveLength(5);
    expect(runout.json().data.walletBalance).toBe(980);
    expect(await database.walletLedgerEntry.findMany({
      orderBy: { sequence: "asc" },
      where: { type: { in: ["PAID_CARD_REVEAL", "HYPOTHETICAL_RUNOUT"] }, userId: fixture.outsider.userId },
    })).toEqual([
      expect.objectContaining({ relatedGameSessionId: null, relatedRoomId: fixture.room.id, signedAmount: -10, type: "PAID_CARD_REVEAL" }),
      expect.objectContaining({ relatedGameSessionId: null, relatedRoomId: fixture.room.id, signedAmount: -10, type: "HYPOTHETICAL_RUNOUT" }),
    ]);
  });

  it("uses the stable per-user hand-history cursor index", async () => {
    const fixture = await historyFixture(database);
    const plan = await database.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      await transaction.$executeRawUnsafe("SET LOCAL enable_sort = off");
      return transaction.$queryRaw<Array<{ readonly "QUERY PLAN": string }>>`
        EXPLAIN SELECT "handId", "createdAt"
        FROM "HandPlayerRecord"
        WHERE "userId" = ${fixture.alice.userId}
        ORDER BY "createdAt" DESC, "handId" DESC
        LIMIT 25
      `;
    });
    expect(plan.map((line) => line["QUERY PLAN"]).join("\n")).toContain("HandPlayerRecord_userId_createdAt_handId_idx");
  });

  it("keeps voluntary reveals private in history until the viewer purchases the hand", async () => {
    const fixture = await historyFixture(database);
    await database.handPlayerRecord.update({
      data: {
        holeCardsPublic: false,
        holeCardsPublicReason: "VOLUNTARY",
        voluntarilyRevealedAt: new Date(),
        voluntarilyRevealedCardIndices: [0],
      },
      where: { handId_userId: { handId, userId: fixture.bob.userId } },
    });

    const partial = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: `/api/hands/${handId}` });
    expect(partial.statusCode, partial.body).toBe(200);
    expect(partial.json().data.players.find((player: { userId: string }) => player.userId === fixture.bob.userId)).toMatchObject({
      handLabel: null,
      holeCards: null,
      holeCardsVisibility: "HIDDEN",
    });
    expect(partial.body).not.toMatch(/Qc|Jh/u);
    const list = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: "/api/hands?limit=10" });
    expect(list.json().data.items[0]).toMatchObject({ hiddenOpponentCount: 1 });

    await database.handPlayerRecord.update({
      data: { holeCardsPublic: true, voluntarilyRevealedCardIndices: [0, 1] },
      where: { handId_userId: { handId, userId: fixture.bob.userId } },
    });
    const complete = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: `/api/hands/${handId}` });
    expect(complete.json().data.players.find((player: { userId: string }) => player.userId === fixture.bob.userId)).toMatchObject({
      handLabel: null,
      holeCards: null,
      holeCardsVisibility: "HIDDEN",
    });
    expect(complete.body).not.toMatch(/Qc|Jh/u);

    const reveal = await app.inject({
      headers: { cookie: fixture.alice.cookie, origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: { operationId: operation("303") },
      url: `/api/hands/${handId}/paid-hand-reveal`,
    });
    expect(reveal.statusCode, reveal.body).toBe(201);
    const purchased = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: `/api/hands/${handId}` });
    expect(purchased.json().data.players.find((player: { userId: string }) => player.userId === fixture.bob.userId)).toMatchObject({
      handLabel: "高牌",
      holeCards: ["Qc", "Jh"],
      holeCardsVisibility: "PURCHASED",
    });
  });

  it("paginates stably and rejects malformed, cross-user, cross-filter or cross-resource cursors", async () => {
    const fixture = await historyFixture(database);
    const secondHandId = "60000000-0000-4000-8000-000000000002";
    const timestamp = new Date("2026-08-20T01:00:30.000Z");
    await database.handRecord.create({ data: {
      bigBlindAmount: 20, bigBlindSeat: 1, board: [], buttonSeat: 0, finishReason: "FOLD_TO_WIN",
      finishedAt: timestamp, handNumber: 2, id: secondHandId, paidCardRevealCost: 10,
      paidCardRevealEnabled: true, roomId: fixture.room.id, smallBlindAmount: 10, smallBlindSeat: 0, startedAt: timestamp,
    } });
    await database.handPlayerRecord.createMany({ data: [
      { allIn: false, committed: 10, endingStack: 390, folded: true, gameSessionId: fixture.aliceGame.id, handId: secondHandId, holeCards: ["Ah", "Kh"], holeCardsPublic: false, netResult: -10, roomId: fixture.room.id, seatIndex: 0, startingStack: 400, userId: fixture.alice.userId },
      { allIn: false, committed: 20, endingStack: 410, folded: false, gameSessionId: fixture.bobGame.id, handId: secondHandId, holeCards: ["Qd", "Jd"], holeCardsPublic: false, netResult: 10, roomId: fixture.room.id, seatIndex: 1, startingStack: 400, userId: fixture.bob.userId },
    ] });
    await database.handActionRecord.create({ data: { actionType: "FOLD", amount: null, automatic: false, clientActionId: operation("92"), handId: secondHandId, raiseTo: null, seatIndex: 0, sequence: 1, stateVersion: 2, street: "PREFLOP", userId: fixture.alice.userId } });
    await database.handPotRecord.create({ data: { amount: 20, contributors: [fixture.alice.userId, fixture.bob.userId], eligiblePlayers: [fixture.bob.userId], handId: secondHandId, oddChipRecipients: [], potIndex: 0, winners: [fixture.bob.userId] } });
    await database.gameSession.create({ data: { endedAt: new Date("2026-08-20T02:01:00.000Z"), roomId: fixture.room.id, seatIndex: 0, startedAt: new Date("2026-08-20T02:00:00.000Z"), status: "CLOSED", totalBuyIn: 400, totalCashOut: 400, userId: fixture.alice.userId } });

    const firstHands = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: "/api/hands?limit=1" });
    const firstHandBody = firstHands.json().data as { items: Array<{ handId: string }>; nextCursor: string };
    const secondHands = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: `/api/hands?limit=1&cursor=${encodeURIComponent(firstHandBody.nextCursor)}` });
    const secondHandBody = secondHands.json().data as { items: Array<{ handId: string }>; nextCursor: string | null };
    expect(new Set([firstHandBody.items[0]!.handId, secondHandBody.items[0]!.handId])).toEqual(new Set([handId, secondHandId]));
    expect(secondHandBody.nextCursor).toBeNull();

    const games = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: "/api/games?limit=1" });
    expect(games.json().data.nextCursor).toEqual(expect.any(String));
    const wrongKind = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: `/api/games?cursor=${encodeURIComponent(firstHandBody.nextCursor)}` });
    expect(wrongKind.statusCode).toBe(400);
    expect(wrongKind.json().error.code).toBe("INVALID_CURSOR");
    const wrongOwner = await app.inject({ headers: { cookie: fixture.bob.cookie }, method: "GET", url: `/api/hands?cursor=${encodeURIComponent(firstHandBody.nextCursor)}` });
    expect(wrongOwner.statusCode).toBe(400);
    expect(wrongOwner.json().error.code).toBe("INVALID_CURSOR");
    const wrongFilter = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: `/api/hands?result=loss&cursor=${encodeURIComponent(firstHandBody.nextCursor)}` });
    expect(wrongFilter.statusCode).toBe(400);
    expect(wrongFilter.json().error.code).toBe("INVALID_CURSOR");
    const malformed = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: "/api/hands?cursor=not-a-cursor" });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe("INVALID_CURSOR");
  });

  it("returns a deterministic participant-only replay without hidden card codes", async () => {
    const fixture = await historyFixture(database);
    const response = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: `/api/hands/${handId}/replay` });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.events.map((event: { type: string }) => event.type)).toEqual([
      "HAND_STARTED", "BLIND_POSTED", "BLIND_POSTED", "PLAYER_FOLDED", "POT_AWARDED", "HAND_FINISHED",
    ]);
    expect(response.json().data.finalState.players.map((player: { stack: number }) => player.stack)).toEqual([390, 410]);
    expect(response.json().data.initialState).toMatchObject({
      bigBlindSeat: 1,
      blinds: { bigBlind: 20, smallBlind: 10 },
      buttonSeat: 0,
      ownHoleCards: ["As", "Kd"],
      publicHoleCardsAtStart: [],
      smallBlindSeat: 0,
      startingStacks: [
        { stack: 400, userId: fixture.alice.userId },
        { stack: 400, userId: fixture.bob.userId },
      ],
    });
    expect(response.body).not.toContain("Qc");
    expect(response.body).not.toContain("Jh");
    expect((await app.inject({ headers: { cookie: fixture.outsider.cookie }, method: "GET", url: `/api/hands/${handId}/replay` })).statusCode).toBe(404);
  });

  it("debits exactly once, replays exactly, and grants cards only to the buyer", async () => {
    const fixture = await historyFixture(database);
    await database.room.update({ data: { paidCardRevealCost: 0, paidCardRevealEnabled: false }, where: { id: fixture.room.id } });
    const playersBefore = await database.handPlayerRecord.findMany({ orderBy: { seatIndex: "asc" }, where: { handId } });
    const stackEntriesBefore = await database.tableStackLedgerEntry.count({ where: { handId } });
    const payload = { operationId: operation("1"), targetUserId: fixture.bob.userId };
    const first = await app.inject({ headers: { cookie: fixture.alice.cookie, origin, "x-wepoker-request": "1" }, method: "POST", payload, url: `/api/hands/${handId}/paid-reveals` });
    const replay = await app.inject({ headers: { cookie: fixture.alice.cookie, origin, "x-wepoker-request": "1" }, method: "POST", payload, url: `/api/hands/${handId}/paid-reveals` });
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(first.json().data).toMatchObject({ cost: 10, holeCards: ["Qc", "Jh"], walletBalance: 990 });
    expect(await database.paidCardReveal.count()).toBe(1);
    expect(await database.walletLedgerEntry.count({ where: { type: "PAID_CARD_REVEAL" } })).toBe(1);
    expect((await database.wallet.findUniqueOrThrow({ where: { userId: fixture.alice.userId } })).balance).toBe(990);
    expect(await database.handPlayerRecord.findMany({ orderBy: { seatIndex: "asc" }, where: { handId } })).toEqual(playersBefore);
    expect(await database.tableStackLedgerEntry.count({ where: { handId } })).toBe(stackEntriesBefore);

    const aliceDetail = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: `/api/hands/${handId}` });
    expect(aliceDetail.statusCode, aliceDetail.body).toBe(200);
    expect(aliceDetail.json().data.players.find((player: { userId: string }) => player.userId === fixture.bob.userId)).toMatchObject({ holeCards: ["Qc", "Jh"], holeCardsVisibility: "PURCHASED" });
    const bobDetail = await app.inject({ headers: { cookie: fixture.bob.cookie }, method: "GET", url: `/api/hands/${handId}` });
    expect(bobDetail.body).not.toContain("As");
    const ledger = await database.walletLedgerEntry.findFirstOrThrow({ where: { type: "PAID_CARD_REVEAL" } });
    expect(JSON.stringify(ledger.metadata)).not.toMatch(/Qc|Jh/);
  });

  it("serializes different-operation purchases on two PostgreSQL clients without double debit", async () => {
    const fixture = await historyFixture(database);
    const environment = loadEnvironment();
    const { createDatabaseClient } = await import("../../db/client.js");
    const second = createDatabaseClient(environment.DATABASE_URL, environment.DATABASE_POOL_MAX);
    try {
      const [left, right] = await Promise.all([
        createPaidCardRevealService(database).purchase(fixture.alice.userId, handId, { operationId: operation("2"), targetUserId: fixture.bob.userId }),
        createPaidCardRevealService(second).purchase(fixture.alice.userId, handId, { operationId: operation("3"), targetUserId: fixture.bob.userId }),
      ]);
      expect([left.alreadyOwned, right.alreadyOwned].sort()).toEqual([false, true]);
      expect(await database.paidCardReveal.count()).toBe(1);
      expect(await database.walletLedgerEntry.count({ where: { type: "PAID_CARD_REVEAL" } })).toBe(1);
      expect((await database.wallet.findUniqueOrThrow({ where: { userId: fixture.alice.userId } })).balance).toBe(990);
    } finally { await second.$disconnect(); }
  });

  it("returns an exact same-operation replay across two PostgreSQL clients", async () => {
    const fixture = await historyFixture(database);
    const environment = loadEnvironment();
    const { createDatabaseClient } = await import("../../db/client.js");
    const second = createDatabaseClient(environment.DATABASE_URL, environment.DATABASE_POOL_MAX);
    const payload = { operationId: operation("31"), targetUserId: fixture.bob.userId };
    try {
      const [left, right] = await Promise.all([
        createPaidCardRevealService(database).purchase(fixture.alice.userId, handId, payload),
        createPaidCardRevealService(second).purchase(fixture.alice.userId, handId, payload),
      ]);
      expect(right).toEqual(left);
      expect(left).toMatchObject({ alreadyOwned: false, cost: 10, holeCards: ["Qc", "Jh"], operationId: payload.operationId, walletBalance: 990 });
      expect(await database.paidCardReveal.count()).toBe(1);
      expect(await database.requestIdempotency.count({ where: { actorId: fixture.alice.userId, key: payload.operationId, scope: "PAID_CARD_REVEAL" } })).toBe(1);
      expect(await database.walletLedgerEntry.count({ where: { type: "PAID_CARD_REVEAL" } })).toBe(1);
      expect((await database.wallet.findUniqueOrThrow({ where: { userId: fixture.alice.userId } })).balance).toBe(990);
    } finally { await second.$disconnect(); }
  });

  it("rejects self, public and changed-payload operations before charging", async () => {
    const fixture = await historyFixture(database);
    const self = await app.inject({ headers: { cookie: fixture.alice.cookie, origin, "x-wepoker-request": "1" }, method: "POST", payload: { operationId: operation("4"), targetUserId: fixture.alice.userId }, url: `/api/hands/${handId}/paid-reveals` });
    expect(self.json().error.code).toBe("TARGET_IS_SELF");
    await expect(createPaidCardRevealService(database).purchase(fixture.outsider.userId, handId, { operationId: operation("41"), targetUserId: fixture.bob.userId })).rejects.toMatchObject({ code: "HAND_ACCESS_DENIED" });
    await expect(createPaidCardRevealService(database).purchase(fixture.alice.userId, handId, { operationId: operation("42"), targetUserId: fixture.outsider.userId })).rejects.toMatchObject({ code: "TARGET_NOT_IN_HAND" });

    await database.handPlayerRecord.update({ data: { holeCardsPublic: true }, where: { handId_userId: { handId, userId: fixture.bob.userId } } });
    const publicCards = await app.inject({ headers: { cookie: fixture.alice.cookie, origin, "x-wepoker-request": "1" }, method: "POST", payload: { operationId: operation("5"), targetUserId: fixture.bob.userId }, url: `/api/hands/${handId}/paid-reveals` });
    expect(publicCards.json().error.code).toBe("CARD_ALREADY_PUBLIC");
    expect(await database.walletLedgerEntry.count({ where: { type: "PAID_CARD_REVEAL" } })).toBe(0);

    await database.handPlayerRecord.update({ data: { holeCardsPublic: false }, where: { handId_userId: { handId, userId: fixture.bob.userId } } });
    const first = await createPaidCardRevealService(database).purchase(fixture.alice.userId, handId, { operationId: operation("6"), targetUserId: fixture.bob.userId });
    expect(first.alreadyOwned).toBe(false);
    await expect(createPaidCardRevealService(database).purchase(fixture.alice.userId, handId, { operationId: operation("6"), targetUserId: fixture.alice.userId })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await database.walletLedgerEntry.count({ where: { type: "PAID_CARD_REVEAL" } })).toBe(1);
  });

  it("rejects unpersisted, legacy-disabled, and insufficient-balance hands without authorization", async () => {
    const fixture = await historyFixture(database);
    await expect(createPaidCardRevealService(database).purchase(
      fixture.alice.userId,
      "60000000-0000-4000-8000-000000000099",
      { operationId: operation("70"), targetUserId: fixture.bob.userId },
    )).rejects.toMatchObject({ code: "HAND_ACCESS_DENIED" });
    await database.handRecord.update({ data: { paidCardRevealCost: 0, paidCardRevealEnabled: false }, where: { id: handId } });
    await expect(createPaidCardRevealService(database).purchase(fixture.alice.userId, handId, { operationId: operation("7"), targetUserId: fixture.bob.userId })).rejects.toMatchObject({ code: "PAID_REVEAL_DISABLED" });
    await database.handRecord.update({ data: { paidCardRevealCost: 10, paidCardRevealEnabled: true }, where: { id: handId } });
    await database.wallet.update({ data: { balance: 5 }, where: { userId: fixture.alice.userId } });
    await expect(createPaidCardRevealService(database).purchase(fixture.alice.userId, handId, { operationId: operation("8"), targetUserId: fixture.bob.userId })).rejects.toMatchObject({ code: "INSUFFICIENT_WALLET_BALANCE" });
    expect(await database.paidCardReveal.count()).toBe(0);
    expect(await database.walletLedgerEntry.count({ where: { type: "PAID_CARD_REVEAL" } })).toBe(0);
  });

  it("rolls back the wallet, ledger, grant, and idempotency receipt after an injected persistence failure", async () => {
    const fixture = await historyFixture(database);
    const walletBefore = await database.wallet.findUniqueOrThrow({ where: { userId: fixture.alice.userId } });
    const injected = new Error("injected paid reveal persistence failure");
    const service = createPaidCardRevealService(database, {
      afterNewPurchaseWrites: () => { throw injected; },
    });

    await expect(service.purchase(fixture.alice.userId, handId, {
      operationId: operation("81"),
      targetUserId: fixture.bob.userId,
    })).rejects.toBe(injected);

    expect(await database.wallet.findUniqueOrThrow({ where: { userId: fixture.alice.userId } })).toEqual(walletBefore);
    expect(await database.walletLedgerEntry.count({ where: { type: "PAID_CARD_REVEAL" } })).toBe(0);
    expect(await database.paidCardReveal.count()).toBe(0);
    expect(await database.requestIdempotency.count({ where: { scope: "PAID_CARD_REVEAL" } })).toBe(0);
  });

  it("keeps different buyers' permanent reveal grants independent", async () => {
    const fixture = await historyFixture(database);
    await database.room.update({ data: { maxSeats: 3 }, where: { id: fixture.room.id } });
    await database.roomMember.create({ data: { role: "MEMBER", roomId: fixture.room.id, userId: fixture.outsider.userId } });
    const carolGame = await database.gameSession.create({
      data: {
        endedAt: new Date("2026-08-20T01:01:00.000Z"),
        roomId: fixture.room.id,
        seatIndex: 2,
        startedAt: new Date("2026-08-20T01:00:00.000Z"),
        status: "CLOSED",
        totalBuyIn: 400,
        totalCashOut: 400,
        userId: fixture.outsider.userId,
      },
    });
    await database.handPlayerRecord.create({
      data: {
        allIn: false,
        committed: 0,
        endingStack: 400,
        folded: true,
        gameSessionId: carolGame.id,
        handId,
        holeCards: ["9c", "8d"],
        holeCardsPublic: false,
        netResult: 0,
        roomId: fixture.room.id,
        seatIndex: 2,
        startingStack: 400,
        userId: fixture.outsider.userId,
      },
    });

    const aliceGrant = await createPaidCardRevealService(database).purchase(fixture.alice.userId, handId, {
      operationId: operation("82"),
      targetUserId: fixture.bob.userId,
    });
    const carolGrant = await createPaidCardRevealService(database).purchase(fixture.outsider.userId, handId, {
      operationId: operation("83"),
      targetUserId: fixture.bob.userId,
    });
    expect(aliceGrant).toMatchObject({ alreadyOwned: false, holeCards: ["Qc", "Jh"], walletBalance: 990 });
    expect(carolGrant).toMatchObject({ alreadyOwned: false, holeCards: ["Qc", "Jh"], walletBalance: 990 });
    expect(await database.paidCardReveal.count()).toBe(2);
    expect(await database.walletLedgerEntry.count({ where: { type: "PAID_CARD_REVEAL" } })).toBe(2);

    const aliceDetail = (await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: `/api/hands/${handId}` })).json().data;
    const carolDetail = (await app.inject({ headers: { cookie: fixture.outsider.cookie }, method: "GET", url: `/api/hands/${handId}` })).json().data;
    const bobResponse = await app.inject({ headers: { cookie: fixture.bob.cookie }, method: "GET", url: `/api/hands/${handId}` });
    expect(aliceDetail.players.find((player: { userId: string }) => player.userId === fixture.bob.userId)).toMatchObject({ holeCards: ["Qc", "Jh"], holeCardsVisibility: "PURCHASED" });
    expect(carolDetail.players.find((player: { userId: string }) => player.userId === fixture.bob.userId)).toMatchObject({ holeCards: ["Qc", "Jh"], holeCardsVisibility: "PURCHASED" });
    expect(bobResponse.body).not.toContain('"holeCards":["As","Kd"]');
    expect(bobResponse.body).not.toContain('"holeCards":["9c","8d"]');
  });

  it("restores a paid reveal grant in a newly constructed application service", async () => {
    const fixture = await historyFixture(database);
    await createPaidCardRevealService(database).purchase(fixture.alice.userId, handId, {
      operationId: operation("84"),
      targetUserId: fixture.bob.userId,
    });
    const restartedRuntimes = new TableRuntimeManager();
    const restartedApp = await buildApp({
      database,
      environment: loadEnvironment(),
      logger: false,
      rateLimit: false,
      runtimes: restartedRuntimes,
    });
    try {
      await restartedApp.ready();
      const detail = await restartedApp.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: `/api/hands/${handId}` });
      expect(detail.statusCode, detail.body).toBe(200);
      expect(detail.json().data.players.find((player: { userId: string }) => player.userId === fixture.bob.userId)).toMatchObject({
        holeCards: ["Qc", "Jh"],
        holeCardsVisibility: "PURCHASED",
      });
    } finally {
      await restartedApp.close();
      restartedRuntimes.close();
    }
  });

  it("does not broadcast a paid reveal purchase to subscribed table sockets", async () => {
    const fixture = await historyFixture(database);
    const isolatedRuntimes = new TableRuntimeManager();
    const isolatedApp = await buildApp({ database, environment: loadEnvironment(), logger: false, rateLimit: false, runtimes: isolatedRuntimes });
    const realtime = attachRealtimeTransport(isolatedApp.server, { database, environment: loadEnvironment(), runtimes: isolatedRuntimes });
    await isolatedApp.listen({ host: "127.0.0.1", port: 0 });
    const address = isolatedApp.server.address();
    if (!address || typeof address === "string") throw new Error("missing paid-reveal socket address");
    const socket = connect(`http://127.0.0.1:${address.port}`, fixture.bob.cookie);
    try {
      await waitForConnect(socket);
      expect(await socket.emitWithAck("table:subscribe", { roomId: fixture.room.id })).toMatchObject({ ok: true });
      const states: unknown[] = [];
      const events: unknown[] = [];
      const errors: unknown[] = [];
      socket.on("table:state", (value) => states.push(value));
      socket.on("table:event", (value) => events.push(value));
      socket.on("table:error", (value) => errors.push(value));

      const response = await isolatedApp.inject({
        headers: { cookie: fixture.alice.cookie, origin, "x-wepoker-request": "1" },
        method: "POST",
        payload: { operationId: operation("85"), targetUserId: fixture.bob.userId },
        url: `/api/hands/${handId}/paid-reveals`,
      });
      expect(response.statusCode, response.body).toBe(201);
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect({ errors, events, states }).toEqual({ errors: [], events: [], states: [] });
    } finally {
      socket.disconnect();
      await realtime.shutdown();
      await isolatedApp.close();
    }
  });

  it("never writes hidden card values or card fields to HTTP logs", async () => {
    const fixture = await historyFixture(database);
    let logs = "";
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        logs += chunk.toString();
        callback();
      },
    });
    const loggedApp = await buildApp({ database, environment: loadEnvironment(), logger: { level: "info", stream }, rateLimit: false });
    try {
      const response = await loggedApp.inject({
        headers: { cookie: fixture.alice.cookie, origin, "x-wepoker-request": "1" },
        method: "POST",
        payload: { operationId: operation("86"), targetUserId: fixture.bob.userId },
        url: `/api/hands/${handId}/paid-reveals`,
      });
      expect(response.statusCode, response.body).toBe(201);
      expect(response.body).toContain("Qc");
    } finally {
      await loggedApp.close();
    }
    expect(logs).not.toMatch(/Qc|Jh|holeCards|deck/);
  });

  it("purchases every hidden opponent card in one hand-level debit and permanently scopes it to the buyer", async () => {
    const fixture = await historyFixture(database);
    const payload = { operationId: operation("201") };
    const first = await app.inject({ headers: { cookie: fixture.alice.cookie, origin, "x-wepoker-request": "1" }, method: "POST", payload, url: `/api/hands/${handId}/paid-hand-reveal` });
    const replay = await app.inject({ headers: { cookie: fixture.alice.cookie, origin, "x-wepoker-request": "1" }, method: "POST", payload, url: `/api/hands/${handId}/paid-hand-reveal` });
    expect(first.statusCode, first.body).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(first.json().data).toMatchObject({ alreadyOwned: false, cost: 10, revealedPlayerCount: 1, walletBalance: 990 });
    expect(await database.paidHandRevealPurchase.count()).toBe(1);
    expect(await database.walletLedgerEntry.count({ where: { type: "PAID_CARD_REVEAL" } })).toBe(1);

    const buyerDetail = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: `/api/hands/${handId}` });
    const otherDetail = await app.inject({ headers: { cookie: fixture.bob.cookie }, method: "GET", url: `/api/hands/${handId}` });
    expect(buyerDetail.json().data.players.find((player: { userId: string }) => player.userId === fixture.bob.userId)).toMatchObject({ holeCards: ["Qc", "Jh"], holeCardsVisibility: "PURCHASED" });
    expect(otherDetail.body).not.toContain('"holeCards":["As","Kd"]');

    const anotherOperation = await app.inject({ headers: { cookie: fixture.alice.cookie, origin, "x-wepoker-request": "1" }, method: "POST", payload: { operationId: operation("202") }, url: `/api/hands/${handId}/paid-hand-reveal` });
    expect(anotherOperation.statusCode).toBe(200);
    expect(anotherOperation.json().data).toMatchObject({ alreadyOwned: true, walletBalance: 990 });
    expect(await database.walletLedgerEntry.count({ where: { type: "PAID_CARD_REVEAL" } })).toBe(1);
  });

  it("upgrades any legacy target grant to whole-hand ownership without a second charge and blocks review-time purchases", async () => {
    const fixture = await historyFixture(database);
    await createPaidCardRevealService(database).purchase(fixture.alice.userId, handId, { operationId: operation("203"), targetUserId: fixture.bob.userId });
    await database.handRecord.update({ data: { reviewEndsAt: new Date(Date.now() + 60_000) }, where: { id: handId } });
    await expect(createPaidHandRevealService(database).purchase(fixture.alice.userId, handId, { operationId: operation("204") })).rejects.toMatchObject({ code: "HAND_REVIEW_IN_PROGRESS" });
    await database.handRecord.update({ data: { reviewEndsAt: new Date(Date.now() - 1_000) }, where: { id: handId } });
    const upgraded = await createPaidHandRevealService(database).purchase(fixture.alice.userId, handId, { operationId: operation("204") });
    expect(upgraded).toMatchObject({ alreadyOwned: true, cost: 0, paidHandRevealPurchaseId: null, walletBalance: 990 });
    expect(await database.paidHandRevealPurchase.count()).toBe(0);
    expect(await database.walletLedgerEntry.count({ where: { type: "PAID_CARD_REVEAL" } })).toBe(1);

    await clearIntegrationDatabase(database);
    const reviewFixture = await historyFixture(database);
    await database.handRecord.update({ data: { reviewEndsAt: new Date(Date.now() + 60_000) }, where: { id: handId } });
    await expect(createPaidHandRevealService(database).purchase(reviewFixture.alice.userId, handId, { operationId: operation("205") })).rejects.toMatchObject({ code: "HAND_REVIEW_IN_PROGRESS" });
    expect((await database.wallet.findUniqueOrThrow({ where: { userId: reviewFixture.alice.userId } })).balance).toBe(1_000);
  });

  it("serializes concurrent whole-hand purchases to one entitlement and one wallet debit", async () => {
    const fixture = await historyFixture(database);
    const environment = loadEnvironment();
    const { createDatabaseClient } = await import("../../db/client.js");
    const second = createDatabaseClient(environment.DATABASE_URL, environment.DATABASE_POOL_MAX);
    try {
      const [left, right] = await Promise.all([
        createPaidHandRevealService(database).purchase(fixture.alice.userId, handId, { operationId: operation("206") }),
        createPaidHandRevealService(second).purchase(fixture.alice.userId, handId, { operationId: operation("207") }),
      ]);
      expect([left.alreadyOwned, right.alreadyOwned].sort()).toEqual([false, true]);
      expect(await database.paidHandRevealPurchase.count()).toBe(1);
      expect(await database.walletLedgerEntry.count({ where: { type: "PAID_CARD_REVEAL" } })).toBe(1);
      expect((await database.wallet.findUniqueOrThrow({ where: { userId: fixture.alice.userId } })).balance).toBe(990);
    } finally { await second.$disconnect(); }
  });

  it("charges each participant once while persisting one shared hypothetical runout", async () => {
    const fixture = await historyFixture(database);
    await database.handRecord.update({ data: { board: ["2c", "3d", "4h"], remainingDeck: ["5s", "6c", "7d"], reviewEndsAt: new Date(Date.now() + 60_000) }, where: { id: handId } });
    await expect(createHypotheticalRunoutService(database).generate(fixture.alice.userId, handId, { operationId: operation("208") })).rejects.toMatchObject({ code: "HAND_REVIEW_IN_PROGRESS" });
    await database.handRecord.update({ data: { reviewEndsAt: new Date(Date.now() - 1_000) }, where: { id: handId } });
    const playersBefore = await database.handPlayerRecord.findMany({ orderBy: { seatIndex: "asc" }, where: { handId } });
    const potsBefore = await database.handPotRecord.findMany({ where: { handId } });
    const walletBefore = await database.wallet.findUniqueOrThrow({ where: { userId: fixture.alice.userId } });
    const first = await createHypotheticalRunoutService(database).generate(fixture.alice.userId, handId, { operationId: operation("208") });
    const sameUserReplay = await createHypotheticalRunoutService(database).generate(fixture.alice.userId, handId, { operationId: operation("208") });
    const otherParticipant = await createHypotheticalRunoutService(database).generate(fixture.bob.userId, handId, { operationId: operation("209") });
    expect(first).toMatchObject({ alreadyOwned: false, cost: 10, runout: { actualBoard: ["2c", "3d", "4h"], cards: ["5s", "6c"], generationSource: "ORIGINAL_REMAINING_DECK", simulatedBoard: ["2c", "3d", "4h", "5s", "6c"] }, walletBalance: walletBefore.balance - 10 });
    expect(sameUserReplay).toEqual(first);
    expect(otherParticipant).toMatchObject({ alreadyOwned: false, cost: 10, runout: { simulatedBoard: first.runout.simulatedBoard } });
    expect(await database.handHypotheticalRunout.count()).toBe(1);
    expect(await database.hypotheticalRunoutPurchase.count()).toBe(2);
    expect(await database.walletLedgerEntry.count({ where: { type: "HYPOTHETICAL_RUNOUT" } })).toBe(2);
    const aliceHistory = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: `/api/hands/${handId}` });
    const bobHistory = await app.inject({ headers: { cookie: fixture.bob.cookie }, method: "GET", url: `/api/hands/${handId}` });
    expect(aliceHistory.json().data.hypotheticalRunout).toEqual(first.runout);
    expect(bobHistory.json().data.hypotheticalRunout).toEqual(first.runout);
    expect(await database.handPlayerRecord.findMany({ orderBy: { seatIndex: "asc" }, where: { handId } })).toEqual(playersBefore);
    expect(await database.handPotRecord.findMany({ where: { handId } })).toEqual(potsBefore);
    expect((await database.wallet.findUniqueOrThrow({ where: { userId: fixture.alice.userId } })).balance).toBe(walletBefore.balance - 10);
    await expect(createHypotheticalRunoutService(database).generate(fixture.outsider.userId, handId, { operationId: operation("210") })).rejects.toMatchObject({ code: "HAND_ACCESS_DENIED" });
  });

  it("serializes hypothetical-runout relation reads on the transaction client", async () => {
    const fixture = await historyFixture(database);
    await database.handRecord.update({
      data: {
        board: ["2c", "3d", "4h"],
        remainingDeck: ["5s", "6c", "7d"],
        reviewEndsAt: new Date(Date.now() - 1_000),
      },
      where: { id: handId },
    });
    const busyClientWarnings: string[] = [];
    const onWarning = (warning: Error) => {
      if (warning.message.includes("client.query() when the client is already executing")) {
        busyClientWarnings.push(warning.message);
      }
    };
    process.on("warning", onWarning);
    try {
      await createHypotheticalRunoutService(database).generate(
        fixture.alice.userId,
        handId,
        { operationId: operation("215") },
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      process.off("warning", onWarning);
    }

    expect(busyClientWarnings).toEqual([]);
  });

  it("serializes concurrent participant purchases to one shared board and one charge each", async () => {
    const fixture = await historyFixture(database);
    await database.handRecord.update({
      data: { board: ["2c", "3d", "4h"], remainingDeck: ["5s", "6c", "7d"], reviewEndsAt: new Date(Date.now() - 1_000) },
      where: { id: handId },
    });
    const walletsBefore = await database.wallet.findMany({
      orderBy: { userId: "asc" },
      where: { userId: { in: [fixture.alice.userId, fixture.bob.userId] } },
    });
    const environment = loadEnvironment();
    const { createDatabaseClient } = await import("../../db/client.js");
    const second = createDatabaseClient(environment.DATABASE_URL, environment.DATABASE_POOL_MAX);
    try {
      const [left, right] = await Promise.all([
        createHypotheticalRunoutService(database).generate(fixture.alice.userId, handId, { operationId: operation("213") }),
        createHypotheticalRunoutService(second).generate(fixture.bob.userId, handId, { operationId: operation("214") }),
      ]);
      expect(right.runout.simulatedBoard).toEqual(left.runout.simulatedBoard);
      expect(left).toMatchObject({ cost: 10, runout: { cards: ["5s", "6c"], generationSource: "ORIGINAL_REMAINING_DECK" } });
      expect(await database.handHypotheticalRunout.count({ where: { handId } })).toBe(1);
      expect(await database.hypotheticalRunoutPurchase.count({ where: { handId } })).toBe(2);
      expect(await database.requestIdempotency.count({ where: { scope: "HYPOTHETICAL_RUNOUT" } })).toBe(2);
      expect((await database.wallet.findMany({
        orderBy: { userId: "asc" },
        where: { userId: { in: [fixture.alice.userId, fixture.bob.userId] } },
      })).map((wallet) => wallet.balance)).toEqual(walletsBefore.map((wallet) => wallet.balance - 10));
    } finally { await second.$disconnect(); }
  });

  it("uses a no-replacement CSPRNG legacy fallback that excludes all real board and hole cards", async () => {
    const fixture = await historyFixture(database);
    await database.handRecord.update({ data: { board: ["2c"], remainingDeck: [] }, where: { id: handId } });
    const result = await createHypotheticalRunoutService(database, { randomIndex: () => 0 }).generate(fixture.alice.userId, handId, { operationId: operation("211") });
    const actuallyDealt = new Set(["2c", "As", "Kd", "Qc", "Jh"]);
    expect(result.runout.generationSource).toBe("CSPRNG_LEGACY_FALLBACK");
    expect(result.runout.cards).toHaveLength(4);
    expect(new Set(result.runout.simulatedBoard).size).toBe(5);
    expect(result.runout.cards.every((card) => !actuallyDealt.has(card))).toBe(true);

    await database.hypotheticalRunoutPurchase.deleteMany({ where: { handId } });
    await database.handHypotheticalRunout.delete({ where: { handId } });
    await database.requestIdempotency.deleteMany({ where: { scope: "HYPOTHETICAL_RUNOUT" } });
    await database.handRecord.update({ data: { board: ["2c", "3d", "4h", "5s", "6c"] }, where: { id: handId } });
    await expect(createHypotheticalRunoutService(database).generate(fixture.alice.userId, handId, { operationId: operation("212") })).rejects.toMatchObject({ code: "HYPOTHETICAL_RUNOUT_NOT_AVAILABLE" });
  });

  it("updates only nickname and returns unambiguous profile statistics", async () => {
    const fixture = await historyFixture(database);
    const runtime = await runtimes.getOrCreate({
      actionTimeSeconds: fixture.room.actionTimeSeconds,
      bigBlind: fixture.room.bigBlind,
      durationMinutes: fixture.room.durationMinutes,
      expiresAt: fixture.room.expiresAt,
      maximumBuyIn: fixture.room.maximumBuyIn,
      maxSeats: fixture.room.maxSeats,
      minimumBuyIn: fixture.room.minimumBuyIn,
      name: fixture.room.name,
      nextHandPaused: fixture.room.nextHandPaused,
      paidCardRevealCost: fixture.room.paidCardRevealCost,
      paidCardRevealEnabled: fixture.room.paidCardRevealEnabled,
      roomCode: fixture.room.roomCode.trim(),
      roomId: fixture.room.id,
      smallBlind: fixture.room.smallBlind,
      status: fixture.room.status,
    });
    runtime.seats.set(0, {
      gameSessionId: fixture.aliceGame.id,
      nickname: "alice",
      playStatus: "ACTIVE",
      seatId: "profile-seat",
      seatIndex: 0,
      stack: 390,
      userId: fixture.alice.userId,
      version: 1,
    });
    const presentationBefore = runtime.presenceVersion;
    const before = await app.inject({ headers: { cookie: fixture.alice.cookie }, method: "GET", url: "/api/profile" });
    expect(before.statusCode, before.body).toBe(200);
    expect(before.json().data).toMatchObject({ handsLost: 1, handsPlayed: 1, handsWon: 0, nickname: "alice", profitableHands: 0, walletBalance: 1_000 });
    const updated = await app.inject({ headers: { cookie: fixture.alice.cookie, origin, "x-wepoker-request": "1" }, method: "PATCH", payload: { nickname: "爱丽丝" }, url: "/api/profile" });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({ nickname: "爱丽丝", username: "alice" });
    expect(projectTableStateForUser(runtime, fixture.alice.userId).seats[0]?.nickname).toBe("爱丽丝");
    expect(runtime.presenceVersion).toBeGreaterThan(presentationBefore);
    expect((await database.user.findUniqueOrThrow({ where: { id: fixture.alice.userId } })).role).toBe("USER");
    const invalid = await app.inject({ headers: { cookie: fixture.alice.cookie, origin, "x-wepoker-request": "1" }, method: "PATCH", payload: { nickname: "<script>", role: "ADMIN" }, url: "/api/profile" });
    expect(invalid.statusCode).toBe(400);
    expect((await database.user.findUniqueOrThrow({ where: { id: fixture.alice.userId } })).nickname).toBe("爱丽丝");
  });
});
