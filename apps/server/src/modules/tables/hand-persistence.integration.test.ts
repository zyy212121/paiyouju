import { createStandardDeck, applyPlayerAction, parseCard, serializeCard, startHand } from "@paiyouju/poker-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseClient } from "../../db/client.js";
import { clearIntegrationDatabase, createIntegrationDatabase, createTestIdentity } from "../../integration/database.js";
import { createTableAccountingService } from "./table-accounting.service.js";
import { createHandPersistenceService } from "./hand-persistence.service.js";

const op = (suffix: string) => `77777777-7777-4777-8777-${suffix.padStart(12, "0")}`;

describe("completed hand persistence", () => {
  let database: DatabaseClient;
  beforeAll(() => { database = createIntegrationDatabase(); });
  beforeEach(async () => clearIntegrationDatabase(database));
  afterAll(async () => database.$disconnect());

  async function setupFinishedHand() {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const bob = await createTestIdentity(database, "bob", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 30, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "持久化", ownerId: alice.userId, paidCardRevealCost: 25, paidCardRevealEnabled: true, roomCode: "404040", smallBlind: 10 } });
    await database.roomMember.createMany({ data: [{ role: "OWNER", roomId: room.id, userId: alice.userId }, { role: "MEMBER", roomId: room.id, userId: bob.userId }] });
    const accounting = createTableAccountingService(database);
    const aliceSeat = await accounting.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: op("1"), roomId: room.id, seatIndex: 0 });
    const bobSeat = await accounting.takeSeat(bob.userId, { buyInAmount: 400, expectedStateVersion: 1, operationId: op("2"), roomId: room.id, seatIndex: 1 });
    const started = startHand({ config: { bigBlind: 20, maxSeats: 2, smallBlind: 10 }, deck: createStandardDeck(), handId: op("99"), previousButtonSeat: null, seats: [{ isParticipating: true, playerId: alice.userId, seatIndex: 0, stack: 400 }, { isParticipating: true, playerId: bob.userId, seatIndex: 1, stack: 400 }] });
    const actor = started.state.players.find((player) => player.seatIndex === started.state.currentActorSeat)!.playerId;
    const finished = applyPlayerAction(started.state, { actionType: "fold", playerId: actor }).state;
    return { alice, aliceSeat, bob, bobSeat, finished, room, started: started.state };
  }

  async function setupBustedHand(squidMode = false) {
    const alice = await createTestIdentity(database, "busted-alice", 10_000);
    const bob = await createTestIdentity(database, "busted-bob", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 30, bigBlind: 20, initialBuyIn: 20, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 20, name: "输光补码", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "414141", smallBlind: 10, specialMode: squidMode ? "SQUID" : "NORMAL", squidStake: squidMode ? 1 : null } });
    await database.roomMember.createMany({ data: [{ role: "OWNER", roomId: room.id, userId: alice.userId }, { role: "MEMBER", roomId: room.id, userId: bob.userId }] });
    const accounting = createTableAccountingService(database);
    const aliceSeat = await accounting.takeSeat(alice.userId, { buyInAmount: 20, expectedStateVersion: 0, operationId: op("101"), roomId: room.id, seatIndex: 0 });
    const bobSeat = await accounting.takeSeat(bob.userId, { buyInAmount: 20, expectedStateVersion: 1, operationId: op("102"), roomId: room.id, seatIndex: 1 });
    const preferred = ["Kc", "Ac", "Kd", "Ad", "2c", "3d", "4h", "8s", "9c"];
    const excluded = new Set(preferred);
    const deck = [
      ...preferred.map(parseCard),
      ...createStandardDeck().filter((card) => !excluded.has(serializeCard(card))),
    ];
    const started = startHand({ config: { bigBlind: 20, maxSeats: 2, smallBlind: 10 }, deck, handId: op("199"), previousButtonSeat: null, seats: [{ isParticipating: true, playerId: alice.userId, seatIndex: 0, stack: 20 }, { isParticipating: true, playerId: bob.userId, seatIndex: 1, stack: 20 }] }).state;
    const actor = started.players.find((player) => player.seatIndex === started.currentActorSeat)!;
    const finished = applyPlayerAction(started, { actionType: "call", playerId: actor.playerId }).state;
    expect(finished.status).toBe("finished");
    expect(finished.players.find((player) => player.playerId === bob.userId)?.stack).toBe(0);
    const result = await createHandPersistenceService(database).persistCompletedHand({
      actions: [{ actionType: "CALL", amount: 10, automatic: false, clientActionId: op("198"), createdAt: new Date("2026-01-01T00:00:01Z"), raiseTo: null, seatIndex: actor.seatIndex, sequence: 1, stateVersion: finished.stateVersion, street: "PREFLOP", userId: actor.playerId }],
      connectedUserIds: new Set([alice.userId, bob.userId]),
      finishedAt: new Date("2026-01-01T00:00:01Z"),
      handNumber: 1,
      handState: finished,
      paidCardRevealCost: 0,
      paidCardRevealEnabled: false,
      roomId: room.id,
      seatSessions: new Map([[alice.userId, aliceSeat.gameSessionId], [bob.userId, bobSeat.gameSessionId]]),
      startedAt: new Date("2026-01-01T00:00:00Z"),
    });
    return { accounting, alice, aliceSeat, bob, bobSeat, finished, result, room };
  }

  it("atomically stores a complete fold-to-win hand and HAND_RESULT ledgers without touching Wallet", async () => {
    const fixture = await setupFinishedHand();
    const walletsBefore = await database.wallet.aggregate({ _sum: { balance: true } });
    const persistence = createHandPersistenceService(database);

    await persistence.persistCompletedHand({
      actions: [{ actionType: "FOLD", amount: null, automatic: false, clientActionId: "24242424-2424-4242-8242-242424242424", createdAt: new Date("2026-01-01T00:00:05Z"), raiseTo: null, seatIndex: fixture.started.currentActorSeat!, sequence: 1, stateVersion: fixture.finished.stateVersion, street: "PREFLOP", userId: fixture.finished.players.find((player) => player.seatIndex === fixture.started.currentActorSeat)!.playerId }],
      connectedUserIds: new Set([fixture.alice.userId, fixture.bob.userId]),
      finishedAt: new Date("2026-01-01T00:00:05Z"),
      handNumber: 1,
      handState: fixture.finished,
      paidCardRevealCost: 25,
      paidCardRevealEnabled: true,
      roomId: fixture.room.id,
      seatSessions: new Map([[fixture.alice.userId, fixture.aliceSeat.gameSessionId], [fixture.bob.userId, fixture.bobSeat.gameSessionId]]),
      startedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const hand = await database.handRecord.findUniqueOrThrow({ include: { actions: true, players: true, pots: true, tableStackEntries: true }, where: { id: fixture.finished.handId } });
    expect(hand).toMatchObject({ finishReason: "FOLD_TO_WIN", handNumber: 1, paidCardRevealCost: 25, paidCardRevealEnabled: true });
    expect(hand.reviewEndsAt).not.toBeNull();
    expect(hand.reviewEndsAt!.getTime() - hand.finishedAt.getTime()).toBe(4_000);
    expect(hand.fullBoard).toEqual([
      ...fixture.finished.board.map(serializeCard),
      ...fixture.finished.deck.slice(0, 5 - fixture.finished.board.length).map(serializeCard),
    ]);
    expect(hand.fullBoard).toHaveLength(5);
    expect(hand.players).toHaveLength(2);
    expect(hand.actions).toHaveLength(1);
    expect(hand.pots.length).toBeGreaterThan(0);
    expect(hand.tableStackEntries).toHaveLength(2);
    expect(hand.players.every((player) => player.netResult === player.endingStack - player.startingStack)).toBe(true);
    expect(hand.tableStackEntries.every((entry) => entry.type === "HAND_RESULT" && entry.walletLedgerEntryId === null && entry.stackAfter === entry.stackBefore + entry.signedAmount)).toBe(true);
    const seats = await database.tableSeat.findMany({ orderBy: { seatIndex: "asc" } });
    expect(seats.reduce((sum, seat) => sum + seat.stack, 0)).toBe(800);
    expect((await database.wallet.aggregate({ _sum: { balance: true } }))._sum.balance).toBe(walletsBefore._sum.balance);
  });

  it("returns stacks above the short-deck cap and replenishes stacks below its floor", async () => {
    const fixture = await setupFinishedHand();
    await database.room.update({
      data: { initialBuyIn: 395, maximumBuyIn: 405, minimumBuyIn: 395, specialMode: "SHORT_DECK" },
      where: { id: fixture.room.id },
    });

    const result = await createHandPersistenceService(database).persistCompletedHand({
      actions: [],
      connectedUserIds: new Set([fixture.alice.userId, fixture.bob.userId]),
      finishedAt: new Date("2026-01-01T00:00:05Z"),
      handNumber: 1,
      handState: fixture.finished,
      paidCardRevealCost: 0,
      paidCardRevealEnabled: false,
      roomId: fixture.room.id,
      seatSessions: new Map([[fixture.alice.userId, fixture.aliceSeat.gameSessionId], [fixture.bob.userId, fixture.bobSeat.gameSessionId]]),
      startedAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(result.remainingSeats.map((seat) => seat.stack).sort((left, right) => left - right)).toEqual([395, 405]);
    const adjustments = await database.tableStackLedgerEntry.findMany({
      orderBy: { signedAmount: "asc" },
      where: { idempotencyKey: { startsWith: `short-deck-stack-limit:${fixture.finished.handId}:` } },
    });
    expect(adjustments.map((entry) => ({ handId: entry.handId, signedAmount: entry.signedAmount, type: entry.type }))).toEqual([
      { handId: fixture.finished.handId, signedAmount: -5, type: "CASH_OUT" },
      { handId: fixture.finished.handId, signedAmount: 5, type: "BUY_IN" },
    ]);
    const sessions = await database.gameSession.findMany({ orderBy: { userId: "asc" }, where: { roomId: fixture.room.id } });
    expect(sessions.map((session) => session.totalBuyIn).sort((left, right) => left - right)).toEqual([400, 405]);
    expect(sessions.map((session) => session.totalCashOut).sort((left, right) => left - right)).toEqual([0, 5]);
    const handPlayers = await database.handPlayerRecord.findMany({ orderBy: { userId: "asc" }, where: { handId: fixture.finished.handId } });
    expect(handPlayers.reduce((sum, player) => sum + player.netResult, 0)).toBe(0);

    await database.room.update({
      data: { closeRequestedAt: new Date("2026-01-01T00:00:08Z"), status: "CLOSING" },
      where: { id: fixture.room.id },
    });
    const persistence = createHandPersistenceService(database);
    await database.$transaction((transaction) => persistence.closeRoomAfterReviewInTransaction(transaction, {
      closedAt: new Date("2026-01-01T00:00:09Z"),
      reviewHandId: fixture.finished.handId,
      roomId: fixture.room.id,
    }));
    const closedSessions = await database.gameSession.findMany({ orderBy: { totalCashOut: "asc" }, where: { roomId: fixture.room.id } });
    expect(closedSessions.map((session) => session.totalCashOut - session.totalBuyIn).sort((left, right) => left - right)).toEqual([-10, 10]);
  });

  it("marks the unique main-pot winner, settles the last unmarked player, and opens a ten-second new-round grace window", async () => {
    const fixture = await setupFinishedHand();
    await database.room.update({ data: { specialMode: "SQUID", squidStake: 20 }, where: { id: fixture.room.id } });
    await database.tableSeat.updateMany({ data: { squidRoundParticipant: true }, where: { roomId: fixture.room.id } });
    const finishedAt = new Date("2026-01-01T00:00:05Z");

    const result = await createHandPersistenceService(database).persistCompletedHand({
      actions: [],
      connectedUserIds: new Set([fixture.alice.userId, fixture.bob.userId]),
      finishedAt,
      handNumber: 1,
      handState: fixture.finished,
      paidCardRevealCost: 0,
      paidCardRevealEnabled: false,
      roomId: fixture.room.id,
      seatSessions: new Map([[fixture.alice.userId, fixture.aliceSeat.gameSessionId], [fixture.bob.userId, fixture.bobSeat.gameSessionId]]),
      startedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const winnerId = fixture.finished.settlement!.pots[0]!.winners[0]!;
    const payerId = winnerId === fixture.alice.userId ? fixture.bob.userId : fixture.alice.userId;
    const pokerStacks = Object.fromEntries(fixture.finished.players.map((player) => [player.playerId, player.stack]));
    const finalStacks = Object.fromEntries(result.remainingSeats.map((seat) => [seat.userId, seat.stack]));
    expect(finalStacks[winnerId]).toBe(pokerStacks[winnerId]! + 20);
    expect(finalStacks[payerId]).toBe(pokerStacks[payerId]! - 20);
    expect(result).toMatchObject({ squidRoundNumber: 2, squidSettlementCompleted: true });
    expect(result.squidRoundGraceEndsAt?.getTime()).toBe(finishedAt.getTime() + 10_000);
    expect(result.remainingSeats.every((seat) => !seat.squidMarked && seat.squidRoundParticipant)).toBe(true);
    const squidEntries = await database.tableStackLedgerEntry.findMany({ orderBy: { signedAmount: "asc" }, where: { roomId: fixture.room.id, type: "SQUID_SETTLEMENT" } });
    expect(squidEntries.map((entry) => entry.signedAmount)).toEqual([-20, 20]);
    expect(squidEntries.every((entry) => entry.stackAfter === entry.stackBefore + entry.signedAmount)).toBe(true);
    const room = await database.room.findUniqueOrThrow({ where: { id: fixture.room.id } });
    expect(room).toMatchObject({ squidRoundNumber: 2, squidSettlementPending: false });
    expect(room.squidRoundGraceEndsAt?.getTime()).toBe(finishedAt.getTime() + 10_000);
    const hand = await database.handRecord.findUniqueOrThrow({ where: { id: fixture.finished.handId } });
    expect(hand.reviewEndsAt?.getTime()).toBe(finishedAt.getTime() + 10_000);
  });

  it("settles an unequal-stack heads-up all-in call without freezing persistence", async () => {
    const short = await createTestIdentity(database, "unequal-short", 10_000);
    const deep = await createTestIdentity(database, "unequal-deep", 10_000);
    const room = await database.room.create({
      data: {
        actionTimeSeconds: 30,
        bigBlind: 20,
        initialBuyIn: 1_000,
        maximumBuyIn: 3_000,
        maxSeats: 2,
        minimumBuyIn: 20,
        name: "不等筹码全下",
        ownerId: short.userId,
        paidCardRevealCost: 10,
        paidCardRevealEnabled: true,
        roomCode: "424242",
        smallBlind: 10,
      },
    });
    await database.roomMember.createMany({
      data: [
        { role: "OWNER", roomId: room.id, userId: short.userId },
        { role: "MEMBER", roomId: room.id, userId: deep.userId },
      ],
    });
    const accounting = createTableAccountingService(database);
    const shortSeat = await accounting.takeSeat(short.userId, { buyInAmount: 1_953, expectedStateVersion: 0, operationId: op("301"), roomId: room.id, seatIndex: 0 });
    const deepSeat = await accounting.takeSeat(deep.userId, { buyInAmount: 2_047, expectedStateVersion: 1, operationId: op("302"), roomId: room.id, seatIndex: 1 });
    await accounting.buyIn(short.userId, { amount: 953, expectedStateVersion: 2, operationId: op("303"), roomId: room.id }, { handInProgress: false });
    await accounting.buyIn(deep.userId, { amount: 1_000, expectedStateVersion: 3, operationId: op("304"), roomId: room.id }, { handInProgress: false });
    await accounting.buyIn(deep.userId, { amount: 47, expectedStateVersion: 4, operationId: op("305"), roomId: room.id }, { handInProgress: false });
    const started = startHand({
      config: { bigBlind: 20, maxSeats: 2, smallBlind: 10 },
      deck: createStandardDeck(),
      handId: op("399"),
      previousButtonSeat: null,
      seats: [
        { isParticipating: true, playerId: short.userId, seatIndex: 0, stack: 1_953 },
        { isParticipating: true, playerId: deep.userId, seatIndex: 1, stack: 2_047 },
      ],
    }).state;
    const firstActor = started.players.find((player) => player.seatIndex === started.currentActorSeat)!;
    expect(firstActor.playerId).toBe(short.userId);
    const afterAllIn = applyPlayerAction(started, { actionType: "allIn", playerId: firstActor.playerId }).state;
    const caller = afterAllIn.players.find((player) => player.seatIndex === afterAllIn.currentActorSeat)!;
    const finished = applyPlayerAction(afterAllIn, { actionType: "call", playerId: caller.playerId }).state;

    expect(finished.status).toBe("finished");
    expect(finished.players.find((player) => player.playerId === deep.userId)).toMatchObject({ committedThisHand: 1_953, isAllIn: false });

    await createHandPersistenceService(database).persistCompletedHand({
      actions: [
        { actionType: "ALL_IN", amount: 1_943, automatic: false, clientActionId: op("397"), createdAt: new Date("2026-01-01T00:00:01Z"), raiseTo: null, seatIndex: firstActor.seatIndex, sequence: 1, stateVersion: afterAllIn.stateVersion, street: "PREFLOP", userId: firstActor.playerId },
        { actionType: "CALL", amount: 1_933, automatic: false, clientActionId: op("398"), createdAt: new Date("2026-01-01T00:00:02Z"), raiseTo: null, seatIndex: caller.seatIndex, sequence: 2, stateVersion: finished.stateVersion, street: "PREFLOP", userId: caller.playerId },
      ],
      connectedUserIds: new Set([short.userId, deep.userId]),
      finishedAt: new Date("2026-01-01T00:00:02Z"),
      handNumber: 1,
      handState: finished,
      paidCardRevealCost: 10,
      paidCardRevealEnabled: true,
      pendingShowCardIndicesByUser: new Map([[deep.userId, [0] as const]]),
      roomId: room.id,
      seatSessions: new Map([[short.userId, shortSeat.gameSessionId], [deep.userId, deepSeat.gameSessionId]]),
      startedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const persistedHand = await database.handRecord.findUniqueOrThrow({ where: { id: finished.handId } });
    expect(persistedHand.reviewEndsAt).not.toBeNull();
    expect(persistedHand.reviewEndsAt!.getTime() - persistedHand.finishedAt.getTime()).toBe(7_000);
    expect(await database.tableStackLedgerEntry.count({ where: { handId: finished.handId, type: "HAND_RESULT" } })).toBe(2);
    expect(await database.handPlayerRecord.findUniqueOrThrow({ where: { handId_userId: { handId: finished.handId, userId: deep.userId } } })).toMatchObject({
      holeCardsPublic: true,
      holeCardsPublicReason: "SHOWDOWN",
      voluntarilyRevealedAt: null,
      voluntarilyRevealedCardIndices: [],
    });
  });

  it("returns the canonical result when two independent clients settle the exact same hand", async () => {
    const fixture = await setupFinishedHand();
    const environment = (await import("../../config/environment.js")).loadEnvironment();
    const second = (await import("../../db/client.js")).createDatabaseClient(environment.DATABASE_URL, environment.DATABASE_POOL_MAX);
    const input = {
      actions: [] as const,
      connectedUserIds: new Set([fixture.alice.userId, fixture.bob.userId]),
      finishedAt: new Date("2026-01-01T00:00:05Z"),
      handNumber: 1,
      handState: fixture.finished,
      paidCardRevealCost: 0,
      paidCardRevealEnabled: false,
      roomId: fixture.room.id,
      seatSessions: new Map([[fixture.alice.userId, fixture.aliceSeat.gameSessionId], [fixture.bob.userId, fixture.bobSeat.gameSessionId]]),
      startedAt: new Date("2026-01-01T00:00:00Z"),
    };
    try {
      const [left, right] = await Promise.all([
        createHandPersistenceService(database).persistCompletedHand(input),
        createHandPersistenceService(second).persistCompletedHand(input),
      ]);

      expect(right).toEqual(left);
      expect(await database.handRecord.count({ where: { id: fixture.finished.handId } })).toBe(1);
      expect(await database.tableStackLedgerEntry.count({ where: { handId: fixture.finished.handId, type: "HAND_RESULT" } })).toBe(2);
      expect(await database.handPlayerRecord.count({ where: { handId: fixture.finished.handId } })).toBe(2);
      expect((await database.tableSeat.aggregate({ _sum: { stack: true }, where: { roomId: fixture.room.id } }))._sum.stack).toBe(800);
    } finally { await second.$disconnect(); }
  });

  it("rolls back every record and stack update when an action violates a database constraint", async () => {
    const fixture = await setupFinishedHand();
    const persistence = createHandPersistenceService(database);
    const stacksBefore = await database.tableSeat.findMany({ orderBy: { seatIndex: "asc" } });

    await expect(persistence.persistCompletedHand({
      actions: [{ actionType: "FOLD", amount: null, automatic: false, clientActionId: "25252525-2525-4252-8252-252525252525", createdAt: new Date(), raiseTo: null, seatIndex: 99, sequence: 1, stateVersion: 2, street: "PREFLOP", userId: fixture.alice.userId }],
      connectedUserIds: new Set([fixture.alice.userId, fixture.bob.userId]), finishedAt: new Date(), handNumber: 1, handState: fixture.finished, paidCardRevealCost: 0, paidCardRevealEnabled: false, roomId: fixture.room.id,
      seatSessions: new Map([[fixture.alice.userId, fixture.aliceSeat.gameSessionId], [fixture.bob.userId, fixture.bobSeat.gameSessionId]]), startedAt: new Date(Date.now() - 1_000),
    })).rejects.toBeInstanceOf(Error);

    expect(await database.handRecord.count()).toBe(0);
    expect(await database.tableStackLedgerEntry.count({ where: { type: "HAND_RESULT" } })).toBe(0);
    expect(await database.tableSeat.findMany({ orderBy: { seatIndex: "asc" } })).toEqual(stacksBefore);
  });

  it("applies explicit deferred sit-out and deferred leave inside the completed-hand transaction", async () => {
    const fixture = await setupFinishedHand();
    await database.tableSeat.update({ data: { playStatus: "SIT_OUT_AFTER_HAND" }, where: { id: fixture.aliceSeat.seatId } });
    await database.tableSeat.update({ data: { playStatus: "LEAVE_AFTER_HAND" }, where: { id: fixture.bobSeat.seatId } });
    const persistence = createHandPersistenceService(database);

    const result = await persistence.persistCompletedHand({
      actions: [],
      connectedUserIds: new Set<string>(),
      finishedAt: new Date("2026-01-01T00:00:05Z"),
      handNumber: 1,
      handState: fixture.finished,
      paidCardRevealCost: 0,
      paidCardRevealEnabled: false,
      roomId: fixture.room.id,
      seatSessions: new Map([[fixture.alice.userId, fixture.aliceSeat.gameSessionId], [fixture.bob.userId, fixture.bobSeat.gameSessionId]]),
      startedAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(result.remainingSeats).toHaveLength(1);
    expect(result.remainingSeats[0]).toMatchObject({ playStatus: "SIT_OUT", userId: fixture.alice.userId });
    expect(await database.tableSeat.findUnique({ where: { id: fixture.bobSeat.seatId } })).toBeNull();
    expect(await database.gameSession.findUniqueOrThrow({ where: { id: fixture.bobSeat.gameSessionId } })).toMatchObject({
      detachedStack: fixture.finished.players.find((player) => player.playerId === fixture.bob.userId)!.stack,
      status: "ACTIVE",
    });
    expect(await database.walletLedgerEntry.count({ where: { relatedGameSessionId: fixture.bobSeat.gameSessionId, type: "CASH_OUT" } })).toBe(0);
    expect(await database.tableStackLedgerEntry.count({ where: { gameSessionId: fixture.bobSeat.gameSessionId, type: "CASH_OUT" } })).toBe(0);
    expect((await database.wallet.aggregate({ _sum: { balance: true } }))._sum.balance).toBe(20_000);
  });

  it("keeps a disconnected active player seated and active after settlement", async () => {
    const fixture = await setupFinishedHand();
    const result = await createHandPersistenceService(database).persistCompletedHand({
      actions: [],
      connectedUserIds: new Set([fixture.alice.userId]),
      finishedAt: new Date("2026-01-01T00:00:05Z"),
      handNumber: 1,
      handState: fixture.finished,
      paidCardRevealCost: 0,
      paidCardRevealEnabled: false,
      roomId: fixture.room.id,
      seatSessions: new Map([[fixture.alice.userId, fixture.aliceSeat.gameSessionId], [fixture.bob.userId, fixture.bobSeat.gameSessionId]]),
      startedAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(result.remainingSeats.find((seat) => seat.userId === fixture.bob.userId)).toMatchObject({ playStatus: "ACTIVE" });
    expect(await database.tableSeat.findUniqueOrThrow({ where: { id: fixture.bobSeat.seatId } })).toMatchObject({ playStatus: "ACTIVE" });
  });

  it("records every final stack and closes a CLOSING room only after the hand transaction succeeds", async () => {
    const fixture = await setupFinishedHand();
    await database.room.update({ data: { closeRequestedAt: new Date("2026-01-01T00:00:02Z"), status: "CLOSING" }, where: { id: fixture.room.id } });
    const persistence = createHandPersistenceService(database);

    const result = await persistence.persistCompletedHand({
      actions: [],
      connectedUserIds: new Set([fixture.alice.userId, fixture.bob.userId]),
      finishedAt: new Date("2026-01-01T00:00:05Z"),
      handNumber: 1,
      handState: fixture.finished,
      paidCardRevealCost: 0,
      paidCardRevealEnabled: false,
      roomId: fixture.room.id,
      seatSessions: new Map([[fixture.alice.userId, fixture.aliceSeat.gameSessionId], [fixture.bob.userId, fixture.bobSeat.gameSessionId]]),
      startedAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(result).toMatchObject({ roomStatus: "CLOSING" });
    expect(result.remainingSeats).toHaveLength(2);
    expect(await database.tableSeat.count({ where: { roomId: fixture.room.id } })).toBe(2);
    expect(await database.walletLedgerEntry.count({ where: { relatedRoomId: fixture.room.id, type: "CASH_OUT" } })).toBe(0);
    expect(await database.room.findUniqueOrThrow({ where: { id: fixture.room.id } })).toMatchObject({ status: "CLOSING" });

    const closed = await database.$transaction((transaction) => persistence.closeRoomAfterReviewInTransaction(transaction, {
      closedAt: new Date("2026-01-01T00:00:08Z"),
      reviewHandId: fixture.finished.handId,
      roomId: fixture.room.id,
    }));
    expect(closed).toEqual({ remainingSeats: [], roomStatus: "CLOSED" });
    expect(await database.tableSeat.count({ where: { roomId: fixture.room.id } })).toBe(0);
    expect(await database.gameSession.count({ where: { roomId: fixture.room.id, status: "CLOSED" } })).toBe(2);
    expect(await database.walletLedgerEntry.count({ where: { relatedRoomId: fixture.room.id, type: "CASH_OUT" } })).toBe(0);
    expect(await database.tableStackLedgerEntry.count({ where: { roomId: fixture.room.id, type: "CASH_OUT" } })).toBe(2);
    expect(await database.room.findUniqueOrThrow({ where: { id: fixture.room.id } })).toMatchObject({ status: "CLOSED" });
    expect((await database.wallet.aggregate({ _sum: { balance: true } }))._sum.balance).toBe(20_000);
  });

  it("automatically stands a zero-stack player while preserving the room session", async () => {
    const fixture = await setupBustedHand();
    expect(fixture.result.remainingSeats.some((seat) => seat.userId === fixture.bob.userId)).toBe(false);
    expect(await database.tableSeat.findUnique({ where: { id: fixture.bobSeat.seatId } })).toBeNull();
    expect(await database.gameSession.findUniqueOrThrow({ where: { id: fixture.bobSeat.gameSessionId } })).toMatchObject({ detachedStack: 0, status: "ACTIVE", totalCashOut: 0 });
    expect((await database.wallet.findUniqueOrThrow({ where: { userId: fixture.bob.userId } })).balance).toBe(10_000);
    expect(await database.walletLedgerEntry.count({ where: { relatedGameSessionId: fixture.bobSeat.gameSessionId, type: "CASH_OUT" } })).toBe(0);
    expect(await database.tableStackLedgerEntry.count({ where: { gameSessionId: fixture.bobSeat.gameSessionId, type: "CASH_OUT" } })).toBe(0);
  });

  it("keeps a busted player seated in squid mode and automatically replenishes to the initial buy-in", async () => {
    const fixture = await setupBustedHand(true);
    const bustedSeat = fixture.result.remainingSeats.find((seat) => seat.userId === fixture.bob.userId);
    expect(bustedSeat).toMatchObject({ playStatus: "ACTIVE", stack: 20, squidMarked: false, squidRoundParticipant: true });
    expect(await database.tableSeat.findUnique({ where: { id: fixture.bobSeat.seatId } })).toMatchObject({ stack: 20 });
    expect(await database.gameSession.findUniqueOrThrow({ where: { id: fixture.bobSeat.gameSessionId } })).toMatchObject({ detachedStack: null, status: "ACTIVE", totalBuyIn: 41 });
    expect(await database.tableStackLedgerEntry.findMany({ orderBy: { sequence: "asc" }, where: { gameSessionId: fixture.bobSeat.gameSessionId } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ signedAmount: 21, type: "BUY_IN" }),
      expect.objectContaining({ signedAmount: -1, type: "SQUID_SETTLEMENT" }),
    ]));
  });
});
