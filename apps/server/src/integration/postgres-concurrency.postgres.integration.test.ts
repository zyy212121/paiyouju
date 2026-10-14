import { createStandardDeck } from "@paiyouju/poker-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadEnvironment } from "../config/environment.js";
import { createDatabaseClient, type DatabaseClient } from "../db/client.js";
import { createWalletService } from "../modules/wallet/wallet.service.js";
import { createTableAccountingService } from "../modules/tables/table-accounting.service.js";
import { finalizeRoomGameSessions } from "../modules/tables/table-session-lifecycle.js";
import { createTableTransitionService } from "../modules/tables/persistence/table-transition.service.js";
import { captureRuntimeAuthority } from "../modules/tables/runtime/runtime-authority-state.js";
import { TableRuntime } from "../modules/tables/runtime/table-runtime.js";
import { createSnapshotRepository } from "../modules/tables/snapshot/snapshot-repository.js";
import { createRoomService } from "../modules/rooms/room.service.js";
import { clearIntegrationDatabase, createTestIdentity } from "./database.js";

describe("standard PostgreSQL multi-connection boundary", () => {
  let first: DatabaseClient;
  let second: DatabaseClient;

  beforeAll(() => {
    const environment = loadEnvironment();
    expect(environment.DATABASE_POOL_MAX).toBeGreaterThanOrEqual(10);
    first = createDatabaseClient(environment.DATABASE_URL, environment.DATABASE_POOL_MAX);
    second = createDatabaseClient(environment.DATABASE_URL, environment.DATABASE_POOL_MAX);
  });

  afterAll(async () => {
    await Promise.all([first.$disconnect(), second.$disconnect()]);
  });

  beforeEach(async () => clearIntegrationDatabase(first));

  it("observes distinct backend PIDs from independent clients", async () => {
    const queries = await Promise.all([
      first.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid FROM (SELECT pg_sleep(0.2)) AS wait`,
      second.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid FROM (SELECT pg_sleep(0.2)) AS wait`,
    ]);
    const pids = new Set(queries.flatMap((rows) => rows.map((row) => row.pid)));

    expect(pids.size).toBeGreaterThanOrEqual(2);
  });

  it("serializes independently connected debits so only one funded mutation commits", async () => {
    const alice = await createTestIdentity(first, "alice", 100);
    const settled = await Promise.allSettled([
      createWalletService(first).applyWalletMutation({ idempotencyKey: "concurrency:debit:a", signedAmount: -80, type: "ADMIN_ADJUSTMENT", userId: alice.userId }),
      createWalletService(second).applyWalletMutation({ idempotencyKey: "concurrency:debit:b", signedAmount: -80, type: "ADMIN_ADJUSTMENT", userId: alice.userId }),
    ]);

    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await first.wallet.findUniqueOrThrow({ where: { userId: alice.userId } })).toMatchObject({ balance: 20, version: 2 });
    expect(await first.walletLedgerEntry.count({ where: { userId: alice.userId } })).toBe(2);
  });

  it("returns one durable result for an identical idempotency key across clients", async () => {
    const alice = await createTestIdentity(first, "alice", 100);
    const input = { idempotencyKey: "concurrency:same-key", signedAmount: -25, type: "ADMIN_ADJUSTMENT" as const, userId: alice.userId };

    const [left, right] = await Promise.all([
      createWalletService(first).applyWalletMutation(input),
      createWalletService(second).applyWalletMutation(input),
    ]);

    expect(left.id).toBe(right.id);
    expect(await first.wallet.findUniqueOrThrow({ where: { userId: alice.userId } })).toMatchObject({ balance: 75, version: 2 });
    expect(await first.walletLedgerEntry.count({ where: { userId: alice.userId } })).toBe(2);
  });

  it("serializes independent positive Wallet updates without lost versions or ledger sequences", async () => {
    const alice = await createTestIdentity(first, "alice", 100);
    const services = [createWalletService(first), createWalletService(second)];
    await Promise.all(Array.from({ length: 8 }, (_, index) => services[index % services.length]!.applyWalletMutation({
      idempotencyKey: `concurrency:credit:${index}`,
      signedAmount: 10,
      type: "ADMIN_ADJUSTMENT",
      userId: alice.userId,
    })));

    expect(await first.wallet.findUniqueOrThrow({ where: { userId: alice.userId } })).toMatchObject({ balance: 180, version: 9 });
    const ledger = await first.walletLedgerEntry.findMany({ orderBy: { sequence: "asc" }, where: { userId: alice.userId } });
    expect(ledger.map((entry) => entry.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(ledger.at(-1)).toMatchObject({ balanceAfter: 180 });
  });

  it("proves SELECT FOR UPDATE blocks client B until client A commits", async () => {
    const alice = await createTestIdentity(first, "alice", 100);
    let releaseFirst!: () => void;
    const firstMayCommit = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstLocked!: () => void;
    const firstHasLock = new Promise<void>((resolve) => { firstLocked = resolve; });
    let secondLocked!: () => void;
    const secondHasLock = new Promise<void>((resolve) => { secondLocked = resolve; });

    const firstTransaction = first.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Wallet" WHERE "userId" = ${alice.userId} FOR UPDATE`;
      firstLocked();
      await firstMayCommit;
    });
    await firstHasLock;
    const secondTransaction = second.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Wallet" WHERE "userId" = ${alice.userId} FOR UPDATE`;
      secondLocked();
    });
    const early = await Promise.race([
      secondHasLock.then(() => "crossed" as const),
      second.$queryRaw`SELECT 1`.then(() => "independent-query-completed" as const),
    ]);
    expect(early).toBe("independent-query-completed");
    releaseFirst();
    await firstTransaction;
    await secondHasLock;
    await secondTransaction;
  });

  it("allocates after the highest durable hand when an upgraded room counter is stale", async () => {
    const alice = await createTestIdentity(first, "legacy-hand-alice", 1_000);
    const bob = await createTestIdentity(first, "legacy-hand-bob", 1_000);
    const room = await first.room.create({ data: { actionTimeSeconds: 30, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 400, maxSeats: 2, minimumBuyIn: 400, name: "旧牌号", nextHandNumber: 1, ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "979797", smallBlind: 10 } });
    await first.roomMember.createMany({ data: [{ role: "OWNER", roomId: room.id, userId: alice.userId }, { role: "MEMBER", roomId: room.id, userId: bob.userId }] });
    await first.handRecord.create({
      data: {
        bigBlindAmount: 20,
        bigBlindSeat: 1,
        board: [],
        buttonSeat: 0,
        finishReason: "FOLD_TO_WIN",
        finishedAt: new Date("2025-12-31T23:59:01.000Z"),
        handNumber: 41,
        id: "97979797-0000-4000-8000-000000000041",
        roomId: room.id,
        smallBlindAmount: 10,
        smallBlindSeat: 0,
        startedAt: new Date("2025-12-31T23:59:00.000Z"),
      },
    });
    const accounting = createTableAccountingService(first);
    const aliceSeat = await accounting.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: "97979797-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 });
    const bobSeat = await accounting.takeSeat(bob.userId, { buyInAmount: 400, expectedStateVersion: 1, operationId: "97979797-0000-4000-8000-000000000002", roomId: room.id, seatIndex: 1 });
    const runtime = new TableRuntime({ actionTimeSeconds: 30, bigBlind: 20, durationMinutes: room.durationMinutes, expiresAt: room.expiresAt, maximumBuyIn: 400, maxSeats: 2, minimumBuyIn: 400, name: room.name, nextHandPaused: false, roomCode: room.roomCode, roomId: room.id, smallBlind: 10, status: "OPEN" });
    runtime.handNumber = 41;
    runtime.seats.set(0, { gameSessionId: aliceSeat.gameSessionId, nickname: "alice", playStatus: "ACTIVE", seatId: aliceSeat.seatId, seatIndex: 0, stack: 400, userId: alice.userId, version: aliceSeat.version });
    runtime.seats.set(1, { gameSessionId: bobSeat.gameSessionId, nickname: "bob", playStatus: "ACTIVE", seatId: bobSeat.seatId, seatIndex: 1, stack: 400, userId: bob.userId, version: bobSeat.version });
    await createSnapshotRepository(first).createInitial(captureRuntimeAuthority(runtime));

    const started = await createTableTransitionService(first).commitStart(captureRuntimeAuthority(runtime), {
      connectedUserIds: new Set([alice.userId, bob.userId]),
      deck: createStandardDeck(),
      handId: "97979797-0000-4000-8000-000000000042",
      now: new Date("2026-01-01T00:00:00.000Z"),
      participatingSeats: [...runtime.seats.values()],
    });

    expect(started.state.currentHand?.handNumber).toBe(42);
    expect(await first.room.findUniqueOrThrow({ where: { id: room.id } })).toMatchObject({ nextHandNumber: 43 });
    expect(await first.tableSnapshot.findUniqueOrThrow({ where: { roomId: room.id } })).toMatchObject({ activeHandNumber: 42 });
  });

  it("allows exactly one user to win a contested seat across independent clients", async () => {
    const alice = await createTestIdentity(first, "alice", 1_000);
    const bob = await createTestIdentity(first, "bob", 1_000);
    const room = await first.room.create({ data: { actionTimeSeconds: 30, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 400, maxSeats: 2, minimumBuyIn: 400, name: "抢座", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "939393", smallBlind: 10 } });
    await first.roomMember.createMany({ data: [{ role: "OWNER", roomId: room.id, userId: alice.userId }, { role: "MEMBER", roomId: room.id, userId: bob.userId }] });

    const settled = await Promise.allSettled([
      createTableAccountingService(first).takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: "93939393-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 }),
      createTableAccountingService(second).takeSeat(bob.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: "93939393-0000-4000-8000-000000000002", roomId: room.id, seatIndex: 0 }),
    ]);

    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await first.tableSeat.count({ where: { roomId: room.id } })).toBe(1);
    expect(await first.gameSession.count({ where: { roomId: room.id, status: "ACTIVE" } })).toBe(1);
    expect(await first.tableStackLedgerEntry.count({ where: { roomId: room.id, type: "BUY_IN" } })).toBe(1);
    expect((await first.wallet.aggregate({ _sum: { balance: true } }))._sum.balance).toBe(2_000);
  });

  it("allows one user to occupy only one of two concurrently requested seats", async () => {
    const alice = await createTestIdentity(first, "alice", 1_000);
    const room = await first.room.create({ data: { actionTimeSeconds: 30, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 400, maxSeats: 2, minimumBuyIn: 400, name: "双座", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "949494", smallBlind: 10 } });
    await first.roomMember.create({ data: { role: "OWNER", roomId: room.id, userId: alice.userId } });

    const settled = await Promise.allSettled([
      createTableAccountingService(first).takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: "94949494-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 }),
      createTableAccountingService(second).takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: "94949494-0000-4000-8000-000000000002", roomId: room.id, seatIndex: 1 }),
    ]);

    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await first.tableSeat.count({ where: { roomId: room.id, userId: alice.userId } })).toBe(1);
    expect(await first.gameSession.count({ where: { roomId: room.id, userId: alice.userId } })).toBe(1);
    expect(await first.wallet.findUniqueOrThrow({ where: { userId: alice.userId } })).toMatchObject({ balance: 1_000, version: 1 });
  });

  it("linearizes room close against buy-in without orphaning a debit, Seat, or Stack", async () => {
    const owner = await createTestIdentity(first, "owner", 1_000);
    const bob = await createTestIdentity(first, "bob", 1_000);
    const room = await first.room.create({ data: { actionTimeSeconds: 30, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 400, maxSeats: 2, minimumBuyIn: 400, name: "关房竞争", ownerId: owner.userId, paidCardRevealCost: 0, roomCode: "969695", smallBlind: 10 } });
    await first.roomMember.createMany({ data: [{ role: "OWNER", roomId: room.id, userId: owner.userId }, { role: "MEMBER", roomId: room.id, userId: bob.userId }] });

    const [close, buyIn] = await Promise.allSettled([
      createRoomService(first).closeRoom(owner.userId, room.id),
      createTableAccountingService(second).takeSeat(bob.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: "96969595-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 }),
    ]);
    expect(close.status).toBe("fulfilled");
    const closed = await first.room.findUniqueOrThrow({ where: { id: room.id } });
    if (buyIn.status === "fulfilled") {
      expect(closed.status).toBe("CLOSING");
      await createTableAccountingService(first).cashOut(bob.userId, { expectedStateVersion: 0, operationId: "96969595-0000-4000-8000-000000000002", roomId: room.id });
      await first.$transaction(async (transaction) => {
        const closedAt = new Date();
        await finalizeRoomGameSessions(transaction, { closedAt, reason: `concurrency-close:${room.id}`, roomId: room.id });
        await transaction.room.update({ data: { closedAt, status: "CLOSED" }, where: { id: room.id } });
      });
    } else {
      expect(closed.status).toBe("CLOSED");
    }
    expect(await first.tableSeat.count({ where: { roomId: room.id } })).toBe(0);
    expect((await first.wallet.findUniqueOrThrow({ where: { userId: bob.userId } })).balance).toBe(1_000);
    expect(await first.walletLedgerEntry.count({ where: { relatedRoomId: room.id } })).toBe(0);
    expect(await first.tableStackLedgerEntry.count({ where: { roomId: room.id, type: "BUY_IN" } })).toBe(buyIn.status === "fulfilled" ? 1 : 0);
  });

  it("applies one durable action receipt and one settlement for two identical concurrent actions", async () => {
    const alice = await createTestIdentity(first, "alice", 1_000);
    const bob = await createTestIdentity(first, "bob", 1_000);
    const room = await first.room.create({ data: { actionTimeSeconds: 30, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 400, maxSeats: 2, minimumBuyIn: 400, name: "行动竞争", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "959595", smallBlind: 10 } });
    await first.roomMember.createMany({ data: [{ role: "OWNER", roomId: room.id, userId: alice.userId }, { role: "MEMBER", roomId: room.id, userId: bob.userId }] });
    const accounting = createTableAccountingService(first);
    const aliceSeat = await accounting.takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: "95959595-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 });
    const bobSeat = await accounting.takeSeat(bob.userId, { buyInAmount: 400, expectedStateVersion: 1, operationId: "95959595-0000-4000-8000-000000000002", roomId: room.id, seatIndex: 1 });
    const runtime = new TableRuntime({ actionTimeSeconds: 30, bigBlind: 20, durationMinutes: room.durationMinutes, expiresAt: room.expiresAt, maximumBuyIn: 400, maxSeats: 2, minimumBuyIn: 400, name: room.name, nextHandPaused: false, roomCode: room.roomCode, roomId: room.id, smallBlind: 10, status: "OPEN" });
    runtime.seats.set(0, { gameSessionId: aliceSeat.gameSessionId, nickname: "alice", playStatus: "ACTIVE", seatId: aliceSeat.seatId, seatIndex: 0, stack: 400, userId: alice.userId, version: aliceSeat.version });
    runtime.seats.set(1, { gameSessionId: bobSeat.gameSessionId, nickname: "bob", playStatus: "ACTIVE", seatId: bobSeat.seatId, seatIndex: 1, stack: 400, userId: bob.userId, version: bobSeat.version });
    await createSnapshotRepository(first).createInitial(captureRuntimeAuthority(runtime));
    const connected = new Set([alice.userId, bob.userId]);
    const started = await createTableTransitionService(first).commitStart(captureRuntimeAuthority(runtime), {
      connectedUserIds: connected,
      deck: createStandardDeck(),
      handId: "95959595-0000-4000-8000-000000000099",
      now: new Date("2026-01-01T00:00:00.000Z"),
      participatingSeats: [...runtime.seats.values()],
    });
    const hand = started.state.currentHand!;
    const actor = hand.state.players.find((player) => player.seatIndex === hand.state.currentActorSeat)!.playerId;
    const input = {
      action: { type: "fold" as const },
      clientActionId: "95959595-0000-4000-8000-000000000003",
      expectedStateVersion: started.state.stateVersion,
      handId: hand.state.handId,
      roomId: room.id,
    };

    const [left, right] = await Promise.all([
      createTableTransitionService(first).commitPlayerAction(started.state, { connectedUserIds: connected, input, now: new Date("2026-01-01T00:00:01.000Z"), userId: actor }),
      createTableTransitionService(second).commitPlayerAction(started.state, { connectedUserIds: connected, input, now: new Date("2026-01-01T00:00:01.000Z"), userId: actor }),
    ]);

    expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
    expect(await first.tableActionReceipt.count({ where: { clientActionId: input.clientActionId } })).toBe(1);
    expect(await first.handRecord.count({ where: { id: hand.state.handId } })).toBe(1);
    expect(await first.tableStackLedgerEntry.count({ where: { handId: hand.state.handId, type: "HAND_RESULT" } })).toBe(2);
    expect(await first.tableSnapshot.findUniqueOrThrow({ where: { roomId: room.id } })).toMatchObject({ activeHandId: null, snapshotRevision: 2 });
  });
});
