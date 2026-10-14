import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseClient } from "../../db/client.js";
import { clearIntegrationDatabase, createIntegrationDatabase, createTestIdentity } from "../../integration/database.js";
import { createTableAccountingService } from "./table-accounting.service.js";
import { finalizeRoomGameSessions } from "./table-session-lifecycle.js";

const operation = (suffix: string) => `11111111-1111-4111-8111-${suffix.padStart(12, "0")}`;

async function createRoom(
  database: DatabaseClient,
  ownerId: string,
  memberIds: readonly string[] = [],
  initialBuyIn = 400,
  roomCode = "303030",
) {
  const room = await database.room.create({
    data: {
      actionTimeSeconds: 30,
      bigBlind: 20,
      initialBuyIn,
      maximumBuyIn: 2_000,
      maxSeats: 2,
      minimumBuyIn: 400,
      name: "桌上记账测试",
      ownerId,
      paidCardRevealCost: 0,
      roomCode,
      smallBlind: 10,
    },
  });
  await database.roomMember.createMany({
    data: [
      { role: "OWNER", roomId: room.id, userId: ownerId },
      ...memberIds.map((userId) => ({ role: "MEMBER" as const, roomId: room.id, userId })),
    ],
  });
  return room;
}

describe("table accounting", () => {
  let database: DatabaseClient;

  beforeAll(() => { database = createIntegrationDatabase(); });
  beforeEach(async () => clearIntegrationDatabase(database));
  afterAll(async () => database.$disconnect());

  it("creates room-scoped points without changing the diamond wallet", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await createRoom(database, alice.userId);
    const service = createTableAccountingService(database);

    const result = await service.takeSeat(alice.userId, {
      buyInAmount: 999,
      expectedStateVersion: 0,
      operationId: operation("1"),
      roomId: room.id,
      seatIndex: 0,
    });

    expect(result).toMatchObject({ seatIndex: 0, stack: 400, walletBalance: 10_000 });
    const seat = await database.tableSeat.findUniqueOrThrow({ where: { roomId_userId: { roomId: room.id, userId: alice.userId } } });
    expect(seat).toMatchObject({ gameSessionId: result.gameSessionId, playStatus: "ACTIVE", stack: 400, version: 1 });
    expect(await database.gameSession.findUniqueOrThrow({ where: { id: result.gameSessionId } })).toMatchObject({ status: "ACTIVE", totalBuyIn: 400, totalCashOut: 0 });
    const tableEntry = await database.tableStackLedgerEntry.findUniqueOrThrow({ where: { idempotencyKey: `table-buy-in:${operation("1")}` } });
    expect(await database.walletLedgerEntry.count({ where: { type: { in: ["BUY_IN", "CASH_OUT"] } } })).toBe(0);
    expect(tableEntry).toMatchObject({ signedAmount: 400, stackAfter: 400, stackBefore: 0, walletLedgerEntryId: null, walletSignedAmount: null, walletType: null });
    expect(await service.auditSystemPoints()).toEqual({ activeTableStacks: 400, wallets: 10_000 });
  });

  it("preserves one room session and its stack across stand and re-seat", async () => {
    const alice = await createTestIdentity(database, "resit-alice", 10_000);
    const room = await createRoom(database, alice.userId, [], 2_000);
    const service = createTableAccountingService(database);
    const first = await service.takeSeat(alice.userId, {
      buyInAmount: 7,
      expectedStateVersion: 0,
      operationId: operation("201"),
      roomId: room.id,
      seatIndex: 0,
    });
    expect(first).toMatchObject({ stack: 2_000, walletBalance: 10_000 });
    await database.tableSeat.update({ data: { stack: 1_350 }, where: { id: first.seatId } });

    const stood = await service.cashOut(alice.userId, {
      expectedStateVersion: 1,
      operationId: operation("202"),
      roomId: room.id,
    });
    expect(stood).toMatchObject({ cashOutAmount: 0, gameSessionId: first.gameSessionId, stack: 1_350, walletBalance: 10_000 });
    expect(await service.auditSystemPoints()).toEqual({ activeTableStacks: 1_350, wallets: 10_000 });

    const second = await service.takeSeat(alice.userId, {
      buyInAmount: 400,
      expectedStateVersion: 2,
      operationId: operation("203"),
      roomId: room.id,
      seatIndex: 1,
    });
    expect(second).toMatchObject({ gameSessionId: first.gameSessionId, stack: 1_350, walletBalance: 10_000 });
    const audit = await service.auditSystemPoints();
    expect(audit).toEqual({ activeTableStacks: 1_350, wallets: 10_000 });
    expect(await database.gameSession.count({ where: { roomId: room.id } })).toBe(1);
    expect(await database.gameSession.findUniqueOrThrow({ where: { id: first.gameSessionId } })).toMatchObject({ detachedStack: null, status: "ACTIVE", totalBuyIn: 2_000, totalCashOut: 0 });
    expect(await database.tableStackLedgerEntry.count({ where: { gameSessionId: first.gameSessionId, type: "BUY_IN" } })).toBe(1);
    expect(await database.tableStackLedgerEntry.count({ where: { gameSessionId: first.gameSessionId, type: "CASH_OUT" } })).toBe(0);
  });

  it("settles seated and detached stacks exactly once only when the room closes", async () => {
    const alice = await createTestIdentity(database, "close-alice", 10_000);
    const bob = await createTestIdentity(database, "close-bob", 10_000);
    const room = await createRoom(database, alice.userId, [bob.userId]);
    const service = createTableAccountingService(database);
    const aliceSeat = await service.takeSeat(alice.userId, { buyInAmount: 1, expectedStateVersion: 0, operationId: operation("204"), roomId: room.id, seatIndex: 0 });
    const bobSeat = await service.takeSeat(bob.userId, { buyInAmount: 1, expectedStateVersion: 1, operationId: operation("205"), roomId: room.id, seatIndex: 1 });
    await database.tableSeat.update({ data: { stack: 725 }, where: { id: aliceSeat.seatId } });
    await service.cashOut(alice.userId, { expectedStateVersion: 2, operationId: operation("206"), roomId: room.id });
    const closedAt = new Date("2026-08-28T00:00:00.000Z");

    await database.$transaction(async (transaction) => {
      await transaction.room.update({ data: { closeRequestedAt: closedAt, status: "CLOSING" }, where: { id: room.id } });
      await finalizeRoomGameSessions(transaction, { closedAt, reason: `test-close:${room.id}`, roomId: room.id });
      await transaction.room.update({ data: { closedAt, status: "CLOSED" }, where: { id: room.id } });
    });
    await database.$transaction((transaction) => finalizeRoomGameSessions(transaction, { closedAt, reason: `test-close:${room.id}`, roomId: room.id }));

    expect(await database.tableSeat.count({ where: { roomId: room.id } })).toBe(0);
    expect(await database.gameSession.findUniqueOrThrow({ where: { id: aliceSeat.gameSessionId } })).toMatchObject({ detachedStack: null, status: "CLOSED", totalBuyIn: 400, totalCashOut: 725 });
    expect(await database.gameSession.findUniqueOrThrow({ where: { id: bobSeat.gameSessionId } })).toMatchObject({ detachedStack: null, status: "CLOSED", totalBuyIn: 400, totalCashOut: 400 });
    expect(await database.tableStackLedgerEntry.count({ where: { roomId: room.id, type: "CASH_OUT" } })).toBe(2);
  });

  it("replays the same operation and rejects a changed payload without a second debit", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await createRoom(database, alice.userId);
    const service = createTableAccountingService(database);
    const input = { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("2"), roomId: room.id, seatIndex: 0 };

    const first = await service.takeSeat(alice.userId, input);
    const replay = await service.takeSeat(alice.userId, input);

    expect(replay).toEqual(first);
    await expect(service.takeSeat(alice.userId, { ...input, buyInAmount: 500 })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await database.tableSeat.count()).toBe(1);
    expect(await database.walletLedgerEntry.count({ where: { type: "BUY_IN" } })).toBe(0);
    expect((await database.wallet.findUniqueOrThrow({ where: { userId: alice.userId } })).balance).toBe(10_000);
  });

  it("rejects occupied seats, double seating, non-members, and closed rooms atomically", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const bob = await createTestIdentity(database, "bob", 500);
    const outsider = await createTestIdentity(database, "outsider", 10_000);
    const room = await createRoom(database, alice.userId, [bob.userId]);
    const service = createTableAccountingService(database);
    await service.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("3"), roomId: room.id, seatIndex: 0 });

    await expect(service.takeSeat(bob.userId, { buyInAmount: 400, expectedStateVersion: 1, operationId: operation("4"), roomId: room.id, seatIndex: 0 })).rejects.toMatchObject({ code: "SEAT_OCCUPIED" });
    await expect(service.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 1, operationId: operation("5"), roomId: room.id, seatIndex: 1 })).rejects.toMatchObject({ code: "USER_ALREADY_SEATED" });
    await expect(service.takeSeat(outsider.userId, { buyInAmount: 400, expectedStateVersion: 1, operationId: operation("6"), roomId: room.id, seatIndex: 1 })).rejects.toMatchObject({ code: "ROOM_ACCESS_DENIED" });
    const bobSeat = await service.takeSeat(bob.userId, { buyInAmount: 1, expectedStateVersion: 1, operationId: operation("8"), roomId: room.id, seatIndex: 1 });
    expect(bobSeat).toMatchObject({ stack: 400, walletBalance: 500 });
    await service.cashOut(bob.userId, { expectedStateVersion: 2, operationId: operation("701"), roomId: room.id });
    await database.room.update({ where: { id: room.id }, data: { status: "CLOSING", closeRequestedAt: new Date() } });
    await expect(service.takeSeat(bob.userId, { buyInAmount: 400, expectedStateVersion: 1, operationId: operation("9"), roomId: room.id, seatIndex: 1 })).rejects.toMatchObject({ code: "ROOM_NOT_OPEN" });
    expect((await database.wallet.findUniqueOrThrow({ where: { userId: bob.userId } })).balance).toBe(500);
    expect(await database.tableSeat.count()).toBe(1);
  });

  it("allows repeated top-ups between hands and enforces the initial-buy-in single-purchase limit", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await createRoom(database, alice.userId);
    const service = createTableAccountingService(database);
    await service.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("10"), roomId: room.id, seatIndex: 0 });
    const input = { amount: 400, expectedStateVersion: 1, operationId: operation("11"), roomId: room.id };

    const toppedUp = await service.buyIn(alice.userId, input, { handInProgress: false });
    const replay = await service.buyIn(alice.userId, input, { handInProgress: false });

    expect(toppedUp).toMatchObject({ stack: 800, walletBalance: 10_000, version: 2 });
    expect(replay).toEqual(toppedUp);
    expect((await database.gameSession.findUniqueOrThrow({ where: { id: toppedUp.gameSessionId } })).totalBuyIn).toBe(800);
    const repeated = await service.buyIn(alice.userId, { ...input, operationId: operation("12"), expectedStateVersion: 2 }, { handInProgress: false });
    expect(repeated).toMatchObject({ stack: 1_200, version: 3 });
    await expect(service.buyIn(alice.userId, { ...input, amount: 401, operationId: operation("13"), expectedStateVersion: 3 }, { handInProgress: false })).rejects.toMatchObject({ code: "BUY_IN_OUT_OF_RANGE" });
    await expect(service.buyIn(alice.userId, { ...input, amount: 100, operationId: operation("14"), expectedStateVersion: 3 }, { handInProgress: true })).rejects.toMatchObject({ code: "BUY_IN_DURING_HAND" });
    expect((await database.wallet.findUniqueOrThrow({ where: { userId: alice.userId } })).balance).toBe(10_000);
  });

  it("adds points to the preserved stack while the player is standing", async () => {
    const alice = await createTestIdentity(database, "standing-top-up", 10_000);
    const room = await createRoom(database, alice.userId, [], 2_000);
    const service = createTableAccountingService(database);
    const seated = await service.takeSeat(alice.userId, { buyInAmount: 2_000, expectedStateVersion: 0, operationId: operation("801"), roomId: room.id, seatIndex: 0 });
    await service.cashOut(alice.userId, { expectedStateVersion: 1, operationId: operation("802"), roomId: room.id });

    const toppedUp = await service.buyIn(alice.userId, { amount: 2_000, expectedStateVersion: 2, operationId: operation("803"), roomId: room.id }, { handInProgress: false });

    expect(toppedUp).toMatchObject({ gameSessionId: seated.gameSessionId, seatId: null, stack: 4_000, walletBalance: 10_000 });
    expect(await database.tableSeat.count({ where: { roomId: room.id, userId: alice.userId } })).toBe(0);
    expect(await database.gameSession.findUniqueOrThrow({ where: { id: seated.gameSessionId } })).toMatchObject({ detachedStack: 4_000, totalBuyIn: 4_000 });
    expect(await database.tableStackLedgerEntry.count({ where: { gameSessionId: seated.gameSessionId, type: "BUY_IN" } })).toBe(2);
    expect((await database.wallet.findUniqueOrThrow({ where: { userId: alice.userId } })).balance).toBe(10_000);
  });

  it("rejects a top-up when current stacks already fill the safe whole-table limit", async () => {
    const alice = await createTestIdentity(database, "alice", 1_000_000_000);
    const bob = await createTestIdentity(database, "bob", 2_000_000_000);
    const room = await database.room.create({
      data: {
        actionTimeSeconds: 30,
        bigBlind: 20,
        initialBuyIn: 1_000_000_000,
        maximumBuyIn: 1_000_000_000,
        maxSeats: 2,
        minimumBuyIn: 400,
        name: "整桌筹码守卫",
        ownerId: alice.userId,
        paidCardRevealCost: 0,
        roomCode: "313131",
        smallBlind: 10,
      },
    });
    await database.roomMember.createMany({ data: [
      { role: "OWNER", roomId: room.id, userId: alice.userId },
      { role: "MEMBER", roomId: room.id, userId: bob.userId },
    ] });
    const service = createTableAccountingService(database);
    const aliceSeat = await service.takeSeat(alice.userId, { buyInAmount: 1_000_000_000, expectedStateVersion: 0, operationId: operation("30"), roomId: room.id, seatIndex: 0 });
    const bobSeat = await service.takeSeat(bob.userId, { buyInAmount: 1_000_000_000, expectedStateVersion: 1, operationId: operation("31"), roomId: room.id, seatIndex: 1 });
    await database.tableSeat.update({ data: { stack: 2_000_000_000 }, where: { id: aliceSeat.seatId } });
    await database.tableSeat.update({ data: { stack: 0 }, where: { id: bobSeat.seatId } });

    await expect(service.buyIn(bob.userId, {
      amount: 1_000_000_000,
      expectedStateVersion: 2,
      operationId: operation("32"),
      roomId: room.id,
    }, { handInProgress: false })).rejects.toMatchObject({ code: "BUY_IN_OUT_OF_RANGE" });

    expect((await database.tableSeat.aggregate({ _sum: { stack: true }, where: { roomId: room.id } }))._sum.stack).toBe(2_000_000_000);
    expect((await database.wallet.findUniqueOrThrow({ where: { userId: bob.userId } })).balance).toBe(2_000_000_000);
  });

  it("counts detached room stacks when enforcing the whole-table safety limit", async () => {
    const alice = await createTestIdentity(database, "detached-limit-alice", 10_000);
    const bob = await createTestIdentity(database, "detached-limit-bob", 10_000);
    const room = await database.room.create({
      data: {
        actionTimeSeconds: 30,
        bigBlind: 20,
        initialBuyIn: 1_000_000_000,
        maximumBuyIn: 1_000_000_000,
        maxSeats: 2,
        minimumBuyIn: 400,
        name: "离座点数守卫",
        ownerId: alice.userId,
        paidCardRevealCost: 0,
        roomCode: "323232",
        smallBlind: 10,
      },
    });
    await database.roomMember.createMany({ data: [
      { role: "OWNER", roomId: room.id, userId: alice.userId },
      { role: "MEMBER", roomId: room.id, userId: bob.userId },
    ] });
    const service = createTableAccountingService(database);
    await service.takeSeat(alice.userId, { buyInAmount: 1, expectedStateVersion: 0, operationId: operation("301"), roomId: room.id, seatIndex: 0 });
    await service.cashOut(alice.userId, { expectedStateVersion: 1, operationId: operation("302"), roomId: room.id });
    await service.takeSeat(bob.userId, { buyInAmount: 1, expectedStateVersion: 2, operationId: operation("303"), roomId: room.id, seatIndex: 1 });

    await expect(service.buyIn(bob.userId, {
      amount: 1,
      expectedStateVersion: 3,
      operationId: operation("304"),
      roomId: room.id,
    }, { handInProgress: false })).rejects.toMatchObject({ code: "BUY_IN_OUT_OF_RANGE" });
    expect(await service.auditSystemPoints()).toEqual({ activeTableStacks: 2_000_000_000, wallets: 20_000 });
  });

  it("allows table outcomes independently from the diamond Wallet limit", async () => {
    const alice = await createTestIdentity(database, "alice", 2_000_000_000);
    const bob = await createTestIdentity(database, "bob", 10_000);
    const room = await createRoom(database, alice.userId, [bob.userId]);
    const service = createTableAccountingService(database);
    await service.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("33"), roomId: room.id, seatIndex: 0 });
    await service.takeSeat(bob.userId, { buyInAmount: 400, expectedStateVersion: 1, operationId: operation("34"), roomId: room.id, seatIndex: 1 });

    await expect(service.assertHandCanStart(room.id, [alice.userId, bob.userId])).resolves.toBeUndefined();

    expect((await database.wallet.findUniqueOrThrow({ where: { userId: alice.userId } })).balance).toBe(2_000_000_000);
    expect((await database.tableSeat.aggregate({ _sum: { stack: true }, where: { roomId: room.id } }))._sum.stack).toBe(800);
  });

  it("ignores stale seats from expired rooms when validating a new hand", async () => {
    const alice = await createTestIdentity(database, "expired-room-alice", 10_000);
    const bob = await createTestIdentity(database, "expired-room-bob", 10_000);
    const expiredRoom = await createRoom(database, alice.userId, [bob.userId], 400, "313131");
    const currentRoom = await createRoom(database, alice.userId, [bob.userId], 400, "323232");
    const service = createTableAccountingService(database);
    await service.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("331"), roomId: expiredRoom.id, seatIndex: 0 });
    await service.takeSeat(bob.userId, { buyInAmount: 400, expectedStateVersion: 1, operationId: operation("332"), roomId: expiredRoom.id, seatIndex: 1 });
    await database.room.update({
      data: { expiresAt: new Date(Date.now() - 60_000), status: "OPEN" },
      where: { id: expiredRoom.id },
    });
    await service.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("333"), roomId: currentRoom.id, seatIndex: 0 });
    await service.takeSeat(bob.userId, { buyInAmount: 400, expectedStateVersion: 1, operationId: operation("334"), roomId: currentRoom.id, seatIndex: 1 });

    await expect(service.assertHandCanStart(currentRoom.id, [alice.userId, bob.userId])).resolves.toBeUndefined();
  });

  it("rejects taking a seat while the same account is active at another live table", async () => {
    const alice = await createTestIdentity(database, "live-room-alice", 10_000);
    const firstRoom = await createRoom(database, alice.userId, [], 400, "333333");
    const secondRoom = await createRoom(database, alice.userId, [], 400, "343434");
    const service = createTableAccountingService(database);
    await service.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("335"), roomId: firstRoom.id, seatIndex: 0 });

    await expect(service.takeSeat(alice.userId, {
      buyInAmount: 400,
      expectedStateVersion: 0,
      operationId: operation("336"),
      roomId: secondRoom.id,
      seatIndex: 0,
    })).rejects.toMatchObject({ code: "TABLE_NOT_AVAILABLE" });
    expect(await database.tableSeat.count({ where: { userId: alice.userId } })).toBe(1);
  });

  it("serializes concurrent seat claims for one account across two live tables", async () => {
    const alice = await createTestIdentity(database, "concurrent-room-alice", 10_000);
    const firstRoom = await createRoom(database, alice.userId, [], 400, "353535");
    const secondRoom = await createRoom(database, alice.userId, [], 400, "363636");
    const service = createTableAccountingService(database);

    const results = await Promise.allSettled([
      service.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("337"), roomId: firstRoom.id, seatIndex: 0 }),
      service.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("338"), roomId: secondRoom.id, seatIndex: 0 }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await database.tableSeat.count({ where: { userId: alice.userId } })).toBe(1);
  });

  it.each([
    { nextHandPaused: true, status: "OPEN" as const },
    { closeRequestedAt: new Date("2026-01-01T00:00:00Z"), nextHandPaused: false, status: "CLOSING" as const },
  ])("refuses to start after the database room state changes before the runtime notification %#", async (roomState) => {
    const alice = await createTestIdentity(database, `alice-${roomState.status}`, 10_000);
    const bob = await createTestIdentity(database, `bob-${roomState.status}`, 10_000);
    const room = await createRoom(database, alice.userId, [bob.userId]);
    const service = createTableAccountingService(database);
    await service.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: operation(roomState.status === "OPEN" ? "37" : "39"), roomId: room.id, seatIndex: 0 });
    await service.takeSeat(bob.userId, { buyInAmount: 400, expectedStateVersion: 1, operationId: operation(roomState.status === "OPEN" ? "38" : "40"), roomId: room.id, seatIndex: 1 });
    await database.room.update({ data: roomState, where: { id: room.id } });

    await expect(service.assertHandCanStart(room.id, [alice.userId, bob.userId])).rejects.toMatchObject({ code: "TABLE_NOT_AVAILABLE" });
  });

  it("rejects a top-up before GameSession totalBuyIn can overflow", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await createRoom(database, alice.userId);
    const service = createTableAccountingService(database);
    const seated = await service.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("35"), roomId: room.id, seatIndex: 0 });
    await database.gameSession.update({ data: { totalBuyIn: 1_999_999_950 }, where: { id: seated.gameSessionId } });

    await expect(service.buyIn(alice.userId, {
      amount: 100,
      expectedStateVersion: 1,
      operationId: operation("36"),
      roomId: room.id,
    }, { handInProgress: false })).rejects.toMatchObject({ code: "BUY_IN_OUT_OF_RANGE" });

    expect(await database.gameSession.findUniqueOrThrow({ where: { id: seated.gameSessionId } })).toMatchObject({ totalBuyIn: 1_999_999_950 });
    expect(await database.tableSeat.findUniqueOrThrow({ where: { id: seated.seatId } })).toMatchObject({ stack: 400 });
  });

  it("sits out immediately or after a hand and returns only between hands", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await createRoom(database, alice.userId);
    const service = createTableAccountingService(database);
    await service.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("14"), roomId: room.id, seatIndex: 0 });

    const deferred = await service.setSitOut(alice.userId, { expectedStateVersion: 1, operationId: operation("15"), roomId: room.id }, { participatingInHand: true });
    expect(deferred.playStatus).toBe("SIT_OUT_AFTER_HAND");
    await expect(service.returnToPlay(alice.userId, { expectedStateVersion: 2, operationId: operation("16"), roomId: room.id }, { handInProgress: true })).rejects.toMatchObject({ code: "PLAYER_NOT_ACTIVE" });
    await database.tableSeat.update({ where: { id: deferred.seatId }, data: { playStatus: "SIT_OUT", version: 3 } });
    const returned = await service.returnToPlay(alice.userId, { expectedStateVersion: 3, operationId: operation("17"), roomId: room.id }, { handInProgress: false });
    expect(returned).toMatchObject({ playStatus: "ACTIVE", stack: 400, version: 4 });
    expect((await database.wallet.findUniqueOrThrow({ where: { userId: alice.userId } })).balance).toBe(10_000);
  });

  it("replays concurrent lifecycle commands instead of applying the transition twice", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await createRoom(database, alice.userId);
    const service = createTableAccountingService(database);
    await service.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("23"), roomId: room.id, seatIndex: 0 });
    const input = { expectedStateVersion: 1, operationId: operation("24"), roomId: room.id };

    const [first, replay] = await Promise.all([
      service.setSitOut(alice.userId, input, { participatingInHand: false }),
      service.setSitOut(alice.userId, input, { participatingInHand: false }),
    ]);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({ playStatus: "SIT_OUT", version: 2 });
    expect((await database.tableSeat.findUniqueOrThrow({ where: { roomId_userId: { roomId: room.id, userId: alice.userId } } })).version).toBe(2);
    expect(await database.requestIdempotency.count({ where: { actorId: alice.userId, key: input.operationId, scope: "TABLE_SIT_OUT" } })).toBe(1);
  });

  it("returns exact results for concurrent take-seat, top-up, return, and seat-detach replays", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await createRoom(database, alice.userId);
    const service = createTableAccountingService(database);
    const takeInput = { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("41"), roomId: room.id, seatIndex: 0 };

    const [taken, takeReplay] = await Promise.all([
      service.takeSeat(alice.userId, takeInput),
      service.takeSeat(alice.userId, takeInput),
    ]);
    expect(takeReplay).toEqual(taken);

    const topUpInput = { amount: 400, expectedStateVersion: 1, operationId: operation("42"), roomId: room.id };
    const [toppedUp, topUpReplay] = await Promise.all([
      service.buyIn(alice.userId, topUpInput, { handInProgress: false }),
      service.buyIn(alice.userId, topUpInput, { handInProgress: false }),
    ]);
    expect(topUpReplay).toEqual(toppedUp);

    await service.setSitOut(alice.userId, { expectedStateVersion: 2, operationId: operation("43"), roomId: room.id }, { participatingInHand: false });
    const returnInput = { expectedStateVersion: 3, operationId: operation("44"), roomId: room.id };
    const [returned, returnReplay] = await Promise.all([
      service.returnToPlay(alice.userId, returnInput, { handInProgress: false }),
      service.returnToPlay(alice.userId, returnInput, { handInProgress: false }),
    ]);
    expect(returnReplay).toEqual(returned);

    const cashOutInput = { expectedStateVersion: 4, operationId: operation("45"), roomId: room.id };
    const [cashedOut, cashOutReplay] = await Promise.all([
      service.cashOut(alice.userId, cashOutInput),
      service.cashOut(alice.userId, cashOutInput),
    ]);
    expect(cashOutReplay).toEqual(cashedOut);
    expect(cashedOut).toMatchObject({ cashOutAmount: 0, stack: 800, walletBalance: 10_000 });
    expect(await database.tableSeat.count()).toBe(0);
    expect(await database.requestIdempotency.count({ where: { actorId: alice.userId } })).toBe(5);
  });

  it("detaches a seat exactly once when idle and defers leave during a hand", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await createRoom(database, alice.userId);
    const service = createTableAccountingService(database);
    const seated = await service.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("18"), roomId: room.id, seatIndex: 0 });
    const leaveInput = { expectedStateVersion: 1, operationId: operation("19"), roomId: room.id };

    const deferred = await service.requestLeave(alice.userId, leaveInput, { participatingInHand: true });
    expect(deferred).toMatchObject({ deferred: true, playStatus: "LEAVE_AFTER_HAND", stack: 400 });
    expect(await database.tableSeat.findUniqueOrThrow({ where: { id: deferred.seatId! } })).toMatchObject({
      nextActionAutoCallCurrentBet: null,
      nextActionAutopilotArmed: true,
      playStatus: "LEAVE_AFTER_HAND",
    });
    expect((await database.wallet.findUniqueOrThrow({ where: { userId: alice.userId } })).balance).toBe(10_000);

    const cashOutInput = { ...leaveInput, expectedStateVersion: 2, operationId: operation("20") };
    const closed = await service.cashOut(alice.userId, cashOutInput);
    const replay = await service.cashOut(alice.userId, cashOutInput);
    expect(closed).toMatchObject({ cashOutAmount: 0, deferred: false, gameSessionId: seated.gameSessionId, seatId: null, stack: 400, walletBalance: 10_000 });
    expect(replay).toEqual(closed);
    expect(await database.tableSeat.count()).toBe(0);
    expect(await database.gameSession.findUniqueOrThrow({ where: { id: seated.gameSessionId } })).toMatchObject({ detachedStack: 400, status: "ACTIVE", totalCashOut: 0 });
    expect(await database.walletLedgerEntry.count({ where: { type: "CASH_OUT" } })).toBe(0);
    expect(await database.tableStackLedgerEntry.count({ where: { type: "CASH_OUT" } })).toBe(0);
    expect(await service.auditSystemPoints()).toEqual({ activeTableStacks: 400, wallets: 10_000 });
  });

  it("requires confirmation and immediately settles an idle unmarked squid leave", async () => {
    const alice = await createTestIdentity(database, "squid-leave-alice", 10_000);
    const bob = await createTestIdentity(database, "squid-leave-bob", 10_000);
    const room = await createRoom(database, alice.userId, [bob.userId]);
    const now = new Date("2026-08-30T12:00:00.000Z");
    await database.room.update({ data: { specialMode: "SQUID", squidStake: 4, tableStartedAt: new Date(now.getTime() - 60_000) }, where: { id: room.id } });
    const service = createTableAccountingService(database);
    const aliceSeat = await service.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("501"), roomId: room.id, seatIndex: 0 });
    const bobSeat = await service.takeSeat(bob.userId, { buyInAmount: 400, expectedStateVersion: 1, operationId: operation("502"), roomId: room.id, seatIndex: 1 });

    await expect(service.requestLeave(alice.userId, { expectedStateVersion: 2, operationId: operation("503"), roomId: room.id }, { now, participatingInHand: false })).rejects.toMatchObject({ code: "SQUID_LEAVE_CONFIRMATION_REQUIRED" });
    const result = await service.requestLeave(alice.userId, { expectedStateVersion: 2, operationId: operation("503"), roomId: room.id }, { confirmSquidPenalty: true, now, participatingInHand: false });

    expect(result).toMatchObject({ deferred: false, seatId: null, stack: 396 });
    expect(await database.gameSession.findUniqueOrThrow({ where: { id: aliceSeat.gameSessionId } })).toMatchObject({ detachedStack: 396, totalBuyIn: 400 });
    expect(await database.tableSeat.findUniqueOrThrow({ where: { id: bobSeat.seatId } })).toMatchObject({ squidMarked: false, squidRoundParticipant: true, stack: 404 });
    const updatedRoom = await database.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(updatedRoom).toMatchObject({ squidRoundNumber: 2, squidSettlementPending: false });
    expect(updatedRoom.squidRoundGraceEndsAt?.getTime()).toBe(now.getTime() + 10_000);
    expect((await database.tableStackLedgerEntry.findMany({ orderBy: { signedAmount: "asc" }, where: { roomId: room.id, type: "SQUID_SETTLEMENT" } })).map((entry) => entry.signedAmount)).toEqual([-4, 4]);
  });

  it("freezes an active unmarked squid leaver as the payer and marks every other unmarked participant", async () => {
    const alice = await createTestIdentity(database, "squid-deferred-alice", 10_000);
    const bob = await createTestIdentity(database, "squid-deferred-bob", 10_000);
    const room = await createRoom(database, alice.userId, [bob.userId]);
    const now = new Date("2026-08-30T12:00:00.000Z");
    await database.room.update({ data: { specialMode: "SQUID", squidStake: 4, tableStartedAt: new Date(now.getTime() - 60_000) }, where: { id: room.id } });
    const service = createTableAccountingService(database);
    const aliceSeat = await service.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("511"), roomId: room.id, seatIndex: 0 });
    const bobSeat = await service.takeSeat(bob.userId, { buyInAmount: 400, expectedStateVersion: 1, operationId: operation("512"), roomId: room.id, seatIndex: 1 });

    const result = await service.requestLeave(alice.userId, { expectedStateVersion: 2, operationId: operation("513"), roomId: room.id }, { confirmSquidPenalty: true, now, participatingInHand: true });

    expect(result).toMatchObject({ deferred: true, playStatus: "LEAVE_AFTER_HAND", seatId: aliceSeat.seatId });
    expect(await database.tableSeat.findUniqueOrThrow({ where: { id: aliceSeat.seatId } })).toMatchObject({ playStatus: "LEAVE_AFTER_HAND", squidMarked: false, squidRoundParticipant: true });
    expect(await database.tableSeat.findUniqueOrThrow({ where: { id: bobSeat.seatId } })).toMatchObject({ squidMarked: true, squidRoundParticipant: true });
    expect(await database.room.findUniqueOrThrow({ where: { id: room.id } })).toMatchObject({ squidSettlementPending: true });
    expect(await database.tableStackLedgerEntry.count({ where: { roomId: room.id, type: "SQUID_SETTLEMENT" } })).toBe(0);
  });

  it("settles immediately when an idle marked leave leaves exactly one unmarked participant", async () => {
    const alice = await createTestIdentity(database, "squid-marked-leave-alice", 10_000);
    const bob = await createTestIdentity(database, "squid-marked-leave-bob", 10_000);
    const charlie = await createTestIdentity(database, "squid-marked-leave-charlie", 10_000);
    const room = await createRoom(database, alice.userId, [bob.userId, charlie.userId]);
    const now = new Date("2026-08-30T12:00:00.000Z");
    await database.room.update({ data: { maxSeats: 3, specialMode: "SQUID", squidStake: 4, tableStartedAt: new Date(now.getTime() - 60_000) }, where: { id: room.id } });
    const service = createTableAccountingService(database);
    const aliceSeat = await service.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("541"), roomId: room.id, seatIndex: 0 });
    const bobSeat = await service.takeSeat(bob.userId, { buyInAmount: 400, expectedStateVersion: 1, operationId: operation("542"), roomId: room.id, seatIndex: 1 });
    const charlieSeat = await service.takeSeat(charlie.userId, { buyInAmount: 400, expectedStateVersion: 2, operationId: operation("543"), roomId: room.id, seatIndex: 2 });
    await database.tableSeat.updateMany({ data: { squidMarked: true }, where: { id: { in: [aliceSeat.seatId, bobSeat.seatId] } } });

    const result = await service.requestLeave(alice.userId, { expectedStateVersion: 3, operationId: operation("544"), roomId: room.id }, { confirmSquidPenalty: true, now, participatingInHand: false });

    expect(result).toMatchObject({ deferred: false, seatId: null, stack: 400 });
    expect(await database.tableSeat.findUniqueOrThrow({ where: { id: bobSeat.seatId } })).toMatchObject({ squidMarked: false, squidRoundParticipant: true, stack: 404 });
    expect(await database.tableSeat.findUniqueOrThrow({ where: { id: charlieSeat.seatId } })).toMatchObject({ squidMarked: false, squidRoundParticipant: true, stack: 396 });
    expect(await database.gameSession.findUniqueOrThrow({ where: { id: aliceSeat.gameSessionId } })).toMatchObject({ detachedStack: 400 });
    const updatedRoom = await database.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(updatedRoom).toMatchObject({ squidRoundNumber: 2, squidSettlementPending: false });
    expect(updatedRoom.squidRoundGraceEndsAt?.getTime()).toBe(now.getTime() + 10_000);
    expect((await database.tableStackLedgerEntry.findMany({ orderBy: { signedAmount: "asc" }, where: { roomId: room.id, type: "SQUID_SETTLEMENT" } })).map((entry) => entry.signedAmount)).toEqual([-4, 4]);
  });

  it("allows a penalty-free squid stand during the ten-second new-round grace window", async () => {
    const alice = await createTestIdentity(database, "squid-grace-alice", 10_000);
    const room = await createRoom(database, alice.userId);
    const now = new Date("2026-08-30T12:00:00.000Z");
    await database.room.update({ data: { specialMode: "SQUID", squidRoundGraceEndsAt: new Date(now.getTime() + 10_000), squidStake: 4, tableStartedAt: new Date(now.getTime() - 60_000) }, where: { id: room.id } });
    const service = createTableAccountingService(database);
    const seat = await service.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("521"), roomId: room.id, seatIndex: 0 });

    const result = await service.requestLeave(alice.userId, { expectedStateVersion: 1, operationId: operation("522"), roomId: room.id }, { now, participatingInHand: false });

    expect(result).toMatchObject({ deferred: false, stack: 400 });
    expect(await database.gameSession.findUniqueOrThrow({ where: { id: seat.gameSessionId } })).toMatchObject({ detachedStack: 400 });
    expect(await database.tableStackLedgerEntry.count({ where: { roomId: room.id, type: "SQUID_SETTLEMENT" } })).toBe(0);
  });

  it("rejects the sit-out lifecycle shortcut in squid mode", async () => {
    const alice = await createTestIdentity(database, "squid-sit-out-alice", 10_000);
    const room = await createRoom(database, alice.userId);
    await database.room.update({ data: { specialMode: "SQUID", squidStake: 4 }, where: { id: room.id } });
    const service = createTableAccountingService(database);
    await service.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("531"), roomId: room.id, seatIndex: 0 });

    await expect(service.setSitOut(alice.userId, { expectedStateVersion: 1, operationId: operation("532"), roomId: room.id }, { participatingInHand: false })).rejects.toMatchObject({ code: "SQUID_RESERVED_AWAY_DISABLED" });
    expect(await database.tableSeat.findUniqueOrThrow({ where: { roomId_userId: { roomId: room.id, userId: alice.userId } } })).toMatchObject({ playStatus: "ACTIVE" });
  });

  it("detaches a zero-stack session without creating meaningless ledger rows", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await createRoom(database, alice.userId);
    const service = createTableAccountingService(database);
    const seated = await service.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("21"), roomId: room.id, seatIndex: 0 });
    await database.tableSeat.update({ where: { id: seated.seatId }, data: { stack: 0, version: 2 } });

    const result = await service.cashOut(alice.userId, { expectedStateVersion: 2, operationId: operation("22"), roomId: room.id });

    expect(result).toMatchObject({ cashOutAmount: 0, stack: 0, walletBalance: 10_000 });
    expect(await database.walletLedgerEntry.count({ where: { type: "CASH_OUT" } })).toBe(0);
    expect(await database.tableStackLedgerEntry.count({ where: { type: "CASH_OUT" } })).toBe(0);
    expect(await database.gameSession.findUniqueOrThrow({ where: { id: seated.gameSessionId } })).toMatchObject({ detachedStack: 0, status: "ACTIVE" });
  });
});
