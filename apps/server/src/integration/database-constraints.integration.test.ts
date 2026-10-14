import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseClient } from "../db/client.js";
import { clearIntegrationDatabase, createIntegrationDatabase, createTestIdentity } from "./database.js";

describe("PostgreSQL migration constraints", () => {
  let database: DatabaseClient;

  beforeAll(() => {
    database = createIntegrationDatabase();
  });
  beforeEach(async () => clearIntegrationDatabase(database));
  afterAll(async () => database.$disconnect());

  it("installs every reviewed domain CHECK constraint", async () => {
    const rows = await database.$queryRawUnsafe<Array<{ constraint_name: string }>>(`
      SELECT conname AS constraint_name
      FROM pg_constraint
      WHERE conname IN (
        'Wallet_balance_range_check',
        'Wallet_version_nonnegative_check',
        'WalletLedgerEntry_balance_equation_check',
        'Room_code_format_check',
        'Room_blinds_check',
        'Room_buy_in_check',
        'Room_actionTimeSeconds_range_step_check',
        'Room_durationMinutes_range_step_check',
        'Room_paid_reveal_check'
        ,'Room_table_points_range_check'
        ,'TableSeat_stack_range_check'
        ,'TableSeat_version_nonnegative_check'
        ,'GameSession_lifecycle_check'
        ,'TableStackLedgerEntry_stack_equation_check'
        ,'TableStackLedgerEntry_room_points_shape_check'
        ,'HandRecord_board_check'
        ,'HandPlayerRecord_result_equation_check'
        ,'HandPlayerRecord_hole_cards_check'
        ,'HandActionRecord_shape_check'
        ,'HandPotRecord_participants_check'
        ,'HandRecord_paid_reveal_check'
        ,'PaidCardReveal_participants_check'
        ,'PaidCardReveal_cost_check'
        ,'PaidCardReveal_wallet_pair_check'
        ,'PaidCardReveal_fingerprint_check'
      )
      ORDER BY conname
    `);

    expect(rows.map((row) => row.constraint_name)).toHaveLength(25);
    const obsolete = await database.$queryRawUnsafe<Array<{ constraint_name: string }>>(`
      SELECT conname AS constraint_name
      FROM pg_constraint
      WHERE conname = 'Room_action_time_check'
    `);
    expect(obsolete).toHaveLength(0);
  });

  it("installs the required unique indexes in the physical database", async () => {
    const rows = await database.$queryRawUnsafe<Array<{ index_name: string }>>(`
      SELECT indexname AS index_name
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'User_usernameNormalized_key',
          'UserSession_tokenHash_key',
          'Wallet_userId_key',
          'Wallet_id_userId_key',
          'WalletLedgerEntry_idempotencyKey_key',
          'WalletLedgerEntry_walletId_sequence_key',
          'Room_roomCode_key',
          'RoomMember_roomId_userId_key',
          'RequestIdempotency_scope_actorId_key_key'
          ,'TableSeat_gameSessionId_key'
          ,'TableSeat_roomId_seatIndex_key'
          ,'TableSeat_roomId_userId_key'
          ,'TableStackLedgerEntry_idempotencyKey_key'
          ,'TableStackLedgerEntry_gameSessionId_sequence_key'
          ,'TableStackLedgerEntry_wallet_transfer_pair_key'
          ,'WalletLedgerEntry_transfer_pair_key'
          ,'HandRecord_roomId_handNumber_key'
          ,'HandPlayerRecord_handId_userId_key'
          ,'HandPlayerRecord_handId_seatIndex_key'
          ,'HandPlayerRecord_handId_roomId_userId_gameSessionId_key'
          ,'HandActionRecord_handId_sequence_key'
          ,'HandActionRecord_handId_userId_clientActionId_key'
          ,'HandPotRecord_handId_potIndex_key'
          ,'WalletLedgerEntry_paid_reveal_pair_key'
          ,'PaidCardReveal_walletLedgerEntryId_key'
          ,'PaidCardReveal_idempotencyKey_key'
          ,'PaidCardReveal_buyerUserId_handId_targetUserId_key'
          ,'PaidCardReveal_wallet_transfer_pair_key'
        )
      ORDER BY indexname
    `);

    expect(rows.map((row) => row.index_name)).toHaveLength(28);
  });

  it("rejects an out-of-range balance even when Prisma bypasses the service", async () => {
    const identity = await createTestIdentity(database, "alice", 10_000);

    await expect(
      database.wallet.update({
        data: { balance: -1 },
        where: { userId: identity.userId },
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(
      await database.wallet.findUniqueOrThrow({ where: { userId: identity.userId } }),
    ).toMatchObject({ balance: 10_000 });
  });

  it("rejects a room whose configured table stack can overflow an INTEGER pot", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);

    await expect(database.room.create({
      data: {
        actionTimeSeconds: 30,
        bigBlind: 20,
        maximumBuyIn: 222_222_223,
        maxSeats: 9,
        minimumBuyIn: 400,
        name: "整桌筹码上限",
        ownerId: alice.userId,
        paidCardRevealCost: 0,
        roomCode: "919191",
        smallBlind: 10,
      },
    })).rejects.toBeInstanceOf(Error);
  });

  it("rejects a ledger whose user does not own its wallet", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const bob = await createTestIdentity(database, "bob", 10_000);
    const aliceWallet = await database.wallet.findUniqueOrThrow({
      where: { userId: alice.userId },
    });

    await expect(
      database.walletLedgerEntry.create({
        data: {
          balanceAfter: 10_001,
          balanceBefore: 10_000,
          idempotencyKey: "constraint:mismatched-wallet-user",
          requestFingerprint: "constraint-test",
          sequence: 2,
          signedAmount: 1,
          type: "ADMIN_ADJUSTMENT",
          userId: bob.userId,
          walletId: aliceWallet.id,
        },
      }),
    ).rejects.toBeInstanceOf(Error);
  });

  it("rejects invalid table stack equations and transfer links", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await database.room.create({
      data: {
        actionTimeSeconds: 30,
        bigBlind: 20,
        maximumBuyIn: 2_000,
        maxSeats: 2,
        minimumBuyIn: 400,
        name: "约束测试",
        ownerId: alice.userId,
        paidCardRevealCost: 0,
        roomCode: "101010",
        smallBlind: 10,
      },
    });
    const session = await database.gameSession.create({
      data: { roomId: room.id, seatIndex: 0, totalBuyIn: 400, userId: alice.userId },
    });

    await expect(database.tableStackLedgerEntry.create({
      data: {
        gameSessionId: session.id,
        idempotencyKey: "buy-in:invalid-equation",
        requestFingerprint: "invalid",
        roomId: room.id,
        sequence: 1,
        signedAmount: 400,
        stackAfter: 399,
        stackBefore: 0,
        type: "BUY_IN",
        userId: alice.userId,
      },
    })).rejects.toBeInstanceOf(Error);
  });

  it("rejects seats, hand players, and transfer pairs linked across identities", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const bob = await createTestIdentity(database, "bob", 10_000);
    const aliceWallet = await database.wallet.findUniqueOrThrow({ where: { userId: alice.userId } });
    const room = await database.room.create({
      data: { actionTimeSeconds: 30, bigBlind: 20, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "复合关系", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "111212", smallBlind: 10 },
    });
    const session = await database.gameSession.create({ data: { roomId: room.id, seatIndex: 0, totalBuyIn: 400, userId: alice.userId } });
    const bobSession = await database.gameSession.create({ data: { roomId: room.id, seatIndex: 1, totalBuyIn: 400, userId: bob.userId } });

    await expect(database.tableSeat.create({
      data: { gameSessionId: session.id, roomId: room.id, seatIndex: 0, stack: 400, userId: bob.userId },
    })).rejects.toBeInstanceOf(Error);

    const hand = await database.handRecord.create({ data: {
      bigBlindAmount: 20, bigBlindSeat: 1, board: ["2c", "3d", "4h", "5s", "6c"], buttonSeat: 0,
      finishReason: "SHOWDOWN", finishedAt: new Date("2026-01-01T00:01:00Z"), handNumber: 1,
      id: "constraint-hand", roomId: room.id, smallBlindAmount: 10, smallBlindSeat: 0, startedAt: new Date("2026-01-01T00:00:00Z"),
    } });
    await expect(database.handPlayerRecord.create({ data: {
      allIn: false, committed: 0, endingStack: 400, folded: false, gameSessionId: session.id,
      handId: hand.id, holeCards: ["Ac", "Kd"], holeCardsPublic: true, netResult: 0,
      roomId: room.id, seatIndex: 0, startingStack: 400, userId: bob.userId,
    } })).rejects.toBeInstanceOf(Error);

    const walletEntry = await database.walletLedgerEntry.create({ data: {
      balanceAfter: 9_600, balanceBefore: 10_000, idempotencyKey: "buy-in:relational-guard",
      relatedGameSessionId: session.id, relatedRoomId: room.id, requestFingerprint: "relational-guard",
      sequence: 2, signedAmount: -400, type: "BUY_IN", userId: alice.userId, walletId: aliceWallet.id,
    } });
    await expect(database.tableStackLedgerEntry.create({ data: {
      gameSessionId: session.id, idempotencyKey: "table-buy-in:wrong-pair", requestFingerprint: "relational-guard",
      roomId: room.id, sequence: 1, signedAmount: 400, stackAfter: 400, stackBefore: 0,
      type: "BUY_IN", userId: alice.userId, walletLedgerEntryId: walletEntry.id,
      walletSignedAmount: -399, walletType: "BUY_IN",
    } })).rejects.toBeInstanceOf(Error);

    await database.handPlayerRecord.create({ data: {
      allIn: false, committed: 0, endingStack: 400, folded: false, gameSessionId: session.id,
      handId: hand.id, holeCards: ["Ac", "Kd"], holeCardsPublic: true, netResult: 0,
      roomId: room.id, seatIndex: 0, startingStack: 400, userId: alice.userId,
    } });
    await expect(database.handActionRecord.create({ data: {
      actionType: "FOLD", amount: null, automatic: false, clientActionId: "constraint-outsider-action",
      handId: hand.id, raiseTo: null, seatIndex: 0, sequence: 1, stateVersion: 2,
      street: "PREFLOP", userId: bob.userId,
    } })).rejects.toBeInstanceOf(Error);

    await database.handPlayerRecord.create({ data: {
      allIn: false, committed: 0, endingStack: 400, folded: false, gameSessionId: bobSession.id,
      handId: hand.id, holeCards: ["Qc", "Jd"], holeCardsPublic: true, netResult: 0,
      roomId: room.id, seatIndex: 1, startingStack: 400, userId: bob.userId,
    } });
    const sharedClientActionId = "constraint-client-action-scope";
    await database.handActionRecord.create({ data: {
      actionType: "CHECK", amount: 0, automatic: false, clientActionId: sharedClientActionId,
      handId: hand.id, raiseTo: null, seatIndex: 0, sequence: 1, stateVersion: 2,
      street: "FLOP", userId: alice.userId,
    } });
    await database.handActionRecord.create({ data: {
      actionType: "CHECK", amount: 0, automatic: false, clientActionId: sharedClientActionId,
      handId: hand.id, raiseTo: null, seatIndex: 1, sequence: 2, stateVersion: 3,
      street: "FLOP", userId: bob.userId,
    } });
    await expect(database.handActionRecord.create({ data: {
      actionType: "CHECK", amount: 0, automatic: false, clientActionId: sharedClientActionId,
      handId: hand.id, raiseTo: null, seatIndex: 0, sequence: 3, stateVersion: 4,
      street: "FLOP", userId: alice.userId,
    } })).rejects.toBeInstanceOf(Error);

    const otherRoom = await database.room.create({ data: {
      actionTimeSeconds: 30, bigBlind: 20, maximumBuyIn: 2_000, maxSeats: 2,
      minimumBuyIn: 400, name: "错误房间", ownerId: alice.userId,
      paidCardRevealCost: 0, roomCode: "111213", smallBlind: 10,
    } });
    const otherSession = await database.gameSession.create({ data: {
      roomId: otherRoom.id, seatIndex: 0, totalBuyIn: 400, userId: alice.userId,
    } });
    await expect(database.tableStackLedgerEntry.create({ data: {
      gameSessionId: otherSession.id, handId: hand.id,
      idempotencyKey: "hand-result:cross-room", requestFingerprint: "cross-room",
      roomId: otherRoom.id, sequence: 1, signedAmount: 0, stackAfter: 400,
      stackBefore: 400, type: "HAND_RESULT", userId: alice.userId,
    } })).rejects.toBeInstanceOf(Error);
  });

  it("rejects paid reveals with invalid participants, cost, room, hand, user, transfer, or duplicate operation", async () => {
    const alice = await createTestIdentity(database, "paid-alice", 10_000);
    const bob = await createTestIdentity(database, "paid-bob", 10_000);
    const outsider = await createTestIdentity(database, "paid-outsider", 10_000);
    const room = await database.room.create({ data: {
      actionTimeSeconds: 30, bigBlind: 20, maximumBuyIn: 2_000, maxSeats: 2,
      minimumBuyIn: 400, name: "付费约束", ownerId: alice.userId,
      paidCardRevealCost: 10, paidCardRevealEnabled: true, roomCode: "313131", smallBlind: 10,
    } });
    const endedAt = new Date("2026-08-20T01:01:00Z");
    const aliceGame = await database.gameSession.create({ data: { endedAt, roomId: room.id, seatIndex: 0, status: "CLOSED", totalBuyIn: 400, totalCashOut: 390, userId: alice.userId } });
    const bobGame = await database.gameSession.create({ data: { endedAt, roomId: room.id, seatIndex: 1, status: "CLOSED", totalBuyIn: 400, totalCashOut: 410, userId: bob.userId } });
    const hand = await database.handRecord.create({ data: {
      bigBlindAmount: 20, bigBlindSeat: 1, board: [], buttonSeat: 0,
      finishReason: "FOLD_TO_WIN", finishedAt: endedAt, handNumber: 1,
      id: "paid-constraint-hand", paidCardRevealCost: 10, paidCardRevealEnabled: true,
      roomId: room.id, smallBlindAmount: 10, smallBlindSeat: 0,
      startedAt: new Date("2026-08-20T01:00:00Z"),
    } });
    await database.handPlayerRecord.createMany({ data: [
      { allIn: false, committed: 10, endingStack: 390, folded: true, gameSessionId: aliceGame.id, handId: hand.id, holeCards: ["As", "Kd"], holeCardsPublic: false, netResult: -10, roomId: room.id, seatIndex: 0, startingStack: 400, userId: alice.userId },
      { allIn: false, committed: 20, endingStack: 410, folded: false, gameSessionId: bobGame.id, handId: hand.id, holeCards: ["Qc", "Jh"], holeCardsPublic: false, netResult: 10, roomId: room.id, seatIndex: 1, startingStack: 400, userId: bob.userId },
    ] });
    const secondHand = await database.handRecord.create({ data: {
      bigBlindAmount: 20, bigBlindSeat: 1, board: [], buttonSeat: 0,
      finishReason: "FOLD_TO_WIN", finishedAt: new Date("2026-08-20T01:03:00Z"), handNumber: 2,
      id: "paid-constraint-hand-2", paidCardRevealCost: 10, paidCardRevealEnabled: true,
      roomId: room.id, smallBlindAmount: 10, smallBlindSeat: 0,
      startedAt: new Date("2026-08-20T01:02:00Z"),
    } });
    await database.handPlayerRecord.createMany({ data: [
      { allIn: false, committed: 10, endingStack: 390, folded: true, gameSessionId: aliceGame.id, handId: secondHand.id, holeCards: ["Ah", "Kh"], holeCardsPublic: false, netResult: -10, roomId: room.id, seatIndex: 0, startingStack: 400, userId: alice.userId },
      { allIn: false, committed: 20, endingStack: 410, folded: false, gameSessionId: bobGame.id, handId: secondHand.id, holeCards: ["Qd", "Jd"], holeCardsPublic: false, netResult: 10, roomId: room.id, seatIndex: 1, startingStack: 400, userId: bob.userId },
    ] });
    const wallet = await database.wallet.findUniqueOrThrow({ where: { userId: alice.userId } });
    const ledger = await database.walletLedgerEntry.create({ data: {
      balanceAfter: 9_990, balanceBefore: 10_000, idempotencyKey: "paid-constraint-ledger",
      relatedGameSessionId: aliceGame.id, relatedHandId: hand.id, relatedRoomId: room.id,
      requestFingerprint: "a".repeat(64), sequence: 2, signedAmount: -10,
      type: "PAID_CARD_REVEAL", userId: alice.userId, walletId: wallet.id,
    } });
    const base = {
      buyerUserId: alice.userId,
      cost: 10,
      handId: hand.id,
      requestFingerprint: "a".repeat(64),
      roomId: room.id,
      walletLedgerEntryId: ledger.id,
      walletSignedAmount: -10,
      walletType: "PAID_CARD_REVEAL" as const,
    };

    const otherRoom = await database.room.create({ data: {
      actionTimeSeconds: 30, bigBlind: 20, maximumBuyIn: 2_000, maxSeats: 2,
      minimumBuyIn: 400, name: "其他付费房间", ownerId: alice.userId,
      paidCardRevealCost: 10, paidCardRevealEnabled: true, roomCode: "323232", smallBlind: 10,
    } });

    await expect(database.paidCardReveal.create({ data: { ...base, idempotencyKey: "paid-self", targetUserId: alice.userId } })).rejects.toBeInstanceOf(Error);
    await expect(database.paidCardReveal.create({ data: { ...base, idempotencyKey: "paid-outsider", targetUserId: outsider.userId } })).rejects.toBeInstanceOf(Error);
    await expect(database.paidCardReveal.create({ data: { ...base, idempotencyKey: "paid-wrong-wallet", targetUserId: bob.userId, walletSignedAmount: -9 } })).rejects.toBeInstanceOf(Error);
    await expect(database.paidCardReveal.create({ data: { ...base, cost: 0, idempotencyKey: "paid-zero-cost", targetUserId: bob.userId } })).rejects.toThrow(/PaidCardReveal_cost_check/u);
    await expect(database.paidCardReveal.create({ data: { ...base, idempotencyKey: "paid-cross-room", roomId: otherRoom.id, targetUserId: bob.userId } })).rejects.toBeInstanceOf(Error);
    await expect(database.paidCardReveal.create({ data: { ...base, handId: secondHand.id, idempotencyKey: "paid-cross-hand", targetUserId: bob.userId } })).rejects.toBeInstanceOf(Error);
    await expect(database.paidCardReveal.create({ data: { ...base, buyerUserId: bob.userId, idempotencyKey: "paid-cross-user", targetUserId: alice.userId } })).rejects.toBeInstanceOf(Error);

    await database.paidCardReveal.create({ data: { ...base, idempotencyKey: "paid-duplicate-operation", targetUserId: bob.userId } });
    const bobWallet = await database.wallet.findUniqueOrThrow({ where: { userId: bob.userId } });
    const bobLedger = await database.walletLedgerEntry.create({ data: {
      balanceAfter: 9_990, balanceBefore: 10_000, idempotencyKey: "paid-bob-ledger",
      relatedGameSessionId: bobGame.id, relatedHandId: secondHand.id, relatedRoomId: room.id,
      requestFingerprint: "b".repeat(64), sequence: 2, signedAmount: -10,
      type: "PAID_CARD_REVEAL", userId: bob.userId, walletId: bobWallet.id,
    } });
    await expect(database.paidCardReveal.create({ data: {
      buyerUserId: bob.userId,
      cost: 10,
      handId: secondHand.id,
      idempotencyKey: "paid-duplicate-operation",
      requestFingerprint: "b".repeat(64),
      roomId: room.id,
      targetUserId: alice.userId,
      walletLedgerEntryId: bobLedger.id,
      walletSignedAmount: -10,
      walletType: "PAID_CARD_REVEAL",
    } })).rejects.toBeInstanceOf(Error);
    expect(await database.paidCardReveal.count()).toBe(1);
  });

  it("deleting the current seat preserves its session and audit history", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await database.room.create({
      data: {
        actionTimeSeconds: 30,
        bigBlind: 20,
        maximumBuyIn: 2_000,
        maxSeats: 2,
        minimumBuyIn: 400,
        name: "历史保留",
        ownerId: alice.userId,
        paidCardRevealCost: 0,
        roomCode: "202020",
        smallBlind: 10,
      },
    });
    const wallet = await database.wallet.findUniqueOrThrow({ where: { userId: alice.userId } });
    const session = await database.gameSession.create({
      data: { roomId: room.id, seatIndex: 0, totalBuyIn: 400, userId: alice.userId },
    });
    const walletEntry = await database.walletLedgerEntry.create({
      data: {
        balanceAfter: 9_600,
        balanceBefore: 10_000,
        idempotencyKey: "buy-in:history",
        relatedGameSessionId: session.id,
        relatedRoomId: room.id,
        requestFingerprint: "history",
        sequence: 2,
        signedAmount: -400,
        type: "BUY_IN",
        userId: alice.userId,
        walletId: wallet.id,
      },
    });
    await database.tableStackLedgerEntry.create({
      data: {
        gameSessionId: session.id,
        idempotencyKey: "table-buy-in:history",
        requestFingerprint: "history",
        roomId: room.id,
        sequence: 1,
        signedAmount: 400,
        stackAfter: 400,
        stackBefore: 0,
        type: "BUY_IN",
        userId: alice.userId,
        walletSignedAmount: -400,
        walletLedgerEntryId: walletEntry.id,
        walletType: "BUY_IN",
      },
    });
    const seat = await database.tableSeat.create({
      data: { gameSessionId: session.id, roomId: room.id, seatIndex: 0, stack: 400, userId: alice.userId },
    });

    await database.tableSeat.delete({ where: { id: seat.id } });

    await expect(database.gameSession.findUniqueOrThrow({ where: { id: session.id } })).resolves.toBeDefined();
    expect(await database.tableStackLedgerEntry.count({ where: { gameSessionId: session.id } })).toBe(1);
    await expect(database.gameSession.delete({ where: { id: session.id } })).rejects.toBeInstanceOf(Error);
  });
});
