import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  clearIntegrationDatabase,
  createIntegrationDatabase,
  createTestIdentity,
} from "../integration/database.js";
import type { Prisma } from "../generated/prisma/client.js";
import { TableRuntime } from "../modules/tables/runtime/table-runtime.js";
import { serializeTableSnapshot } from "../modules/tables/snapshot/snapshot-codec.js";
import { runDataAudit } from "./data-audit.js";

const database = createIntegrationDatabase();

describe("read-only data audit", () => {
  beforeEach(async () => clearIntegrationDatabase(database));
  afterAll(async () => {
    await clearIntegrationDatabase(database);
    await database.$disconnect();
  });

  it("passes a clean wallet chain and reports only safe aggregate checks", async () => {
    const identity = await createTestIdentity(database, "audit-person", 10_000);
    await database.user.update({
      data: { phoneNumber: "13800001234" },
      where: { id: identity.userId },
    });
    const report = await runDataAudit(database);
    expect(report.ok).toBe(true);
    expect(report.failureCount).toBe(0);
    expect(JSON.stringify(report)).not.toMatch(/13800001234|audit-person|holeCards|payload/iu);
  });

  it("detects but never repairs a wallet-to-ledger mismatch", async () => {
    const identity = await createTestIdentity(database, "audit-corrupt", 10_000);
    await database.wallet.update({ data: { balance: 9_999 }, where: { userId: identity.userId } });

    const report = await runDataAudit(database);
    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.code === "WALLET_TAIL_MISMATCH")?.count).toBe(1);
    expect((await database.wallet.findUniqueOrThrow({ where: { userId: identity.userId } })).balance).toBe(9_999);
  });

  it("accepts a wallet chain gap left by authorized room-data deletion", async () => {
    const identity = await createTestIdentity(database, "audit-deleted-room-ledger", 10_000);
    const wallet = await database.wallet.findUniqueOrThrow({ where: { userId: identity.userId } });
    const room = await database.room.create({
      data: {
        actionTimeSeconds: 30,
        bigBlind: 20,
        closedAt: new Date(),
        closeRequestedAt: new Date(),
        maximumBuyIn: 2_000,
        maxSeats: 2,
        minimumBuyIn: 400,
        name: "已删除流水审计房间",
        ownerId: identity.userId,
        roomCode: "848484",
        smallBlind: 10,
        status: "CLOSED",
      },
    });
    await database.walletLedgerEntry.createMany({ data: [
      {
        balanceAfter: 9_990,
        balanceBefore: 10_000,
        idempotencyKey: "audit-room-fee",
        relatedRoomId: room.id,
        requestFingerprint: "audit-room-fee",
        sequence: 2,
        signedAmount: -10,
        type: "HAND_ENTRY_FEE",
        userId: identity.userId,
        walletId: wallet.id,
      },
      {
        balanceAfter: 10_010,
        balanceBefore: 9_990,
        idempotencyKey: "audit-adjustment-after-room",
        requestFingerprint: "audit-adjustment-after-room",
        sequence: 3,
        signedAmount: 20,
        type: "ADMIN_ADJUSTMENT",
        userId: identity.userId,
        walletId: wallet.id,
      },
    ] });
    await database.wallet.update({ data: { balance: 10_010, version: 3 }, where: { id: wallet.id } });
    await database.walletLedgerEntry.delete({ where: { idempotencyKey: "audit-room-fee" } });
    await database.room.delete({ where: { id: room.id } });

    const report = await runDataAudit(database);

    expect(report.checks.find((check) => check.code === "WALLET_LEDGER_CHAIN")).toEqual({
      code: "WALLET_LEDGER_CHAIN",
      count: 0,
      status: "PASS",
    });
    expect(report.ok).toBe(true);
  });

  it("accepts a clockless older snapshot when the room row supplies the authoritative clock", async () => {
    const owner = await createTestIdentity(database, "audit-legacy-clock", 10_000);
    const room = await database.room.create({
      data: {
        actionTimeSeconds: 30,
        bigBlind: 20,
        durationMinutes: 60,
        maximumBuyIn: 2_000,
        maxSeats: 2,
        minimumBuyIn: 400,
        name: "审计旧快照",
        ownerId: owner.userId,
        paidCardRevealCost: 50,
        paidCardRevealEnabled: true,
        roomCode: "868686",
        smallBlind: 10,
      },
    });
    const runtime = new TableRuntime({
      actionTimeSeconds: room.actionTimeSeconds,
      bigBlind: room.bigBlind,
      durationMinutes: room.durationMinutes,
      expiresAt: room.expiresAt,
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
      smallBlind: room.smallBlind,
      status: room.status,
      tableStartedAt: room.tableStartedAt,
    });
    const snapshot = serializeTableSnapshot(runtime);
    const payload = structuredClone(snapshot.payload) as unknown as {
      room: { durationMinutes?: number; expiresAt?: string };
    };
    delete payload.room.durationMinutes;
    delete payload.room.expiresAt;
    await database.tableSnapshot.create({
      data: {
        ...snapshot,
        lastRecoveryError: "payload-schema:room.durationMinutes",
        payload: payload as Prisma.InputJsonValue,
        recoveryStatus: "ERROR",
        roomId: room.id,
        runtimeStatus: "RECOVERY_ERROR",
      },
    });

    const report = await runDataAudit(database);

    expect(report.checks.find((check) => check.code === "SNAPSHOT_SCHEMA")).toEqual({
      code: "SNAPSHOT_SCHEMA",
      count: 0,
      status: "PASS",
    });
  });

  it("requires every posted blind to be represented by an awarded pot", async () => {
    const winner = await createTestIdentity(database, "audit-uncalled-winner", 10_000);
    const folder = await createTestIdentity(database, "audit-uncalled-folder", 10_000);
    const room = await database.room.create({
      data: {
        actionTimeSeconds: 30,
        bigBlind: 20,
        maximumBuyIn: 2_000,
        maxSeats: 2,
        minimumBuyIn: 400,
        name: "审计完整底池",
        ownerId: winner.userId,
        paidCardRevealCost: 50,
        paidCardRevealEnabled: true,
        roomCode: "858585",
        smallBlind: 10,
      },
    });
    const startedAt = new Date("2026-08-25T01:00:00.000Z");
    const finishedAt = new Date("2026-08-25T01:00:10.000Z");
    const winnerSession = await database.gameSession.create({
      data: {
        endedAt: finishedAt,
        roomId: room.id,
        seatIndex: 1,
        startedAt,
        status: "CLOSED",
        totalBuyIn: 400,
        totalCashOut: 410,
        userId: winner.userId,
      },
    });
    const folderSession = await database.gameSession.create({
      data: {
        endedAt: finishedAt,
        roomId: room.id,
        seatIndex: 0,
        startedAt,
        status: "CLOSED",
        totalBuyIn: 400,
        totalCashOut: 390,
        userId: folder.userId,
      },
    });
    const handId = "85858585-8585-4858-8858-858585858585";
    await database.handRecord.create({
      data: {
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
      },
    });
    await database.handPlayerRecord.createMany({
      data: [
        {
          allIn: false,
          committed: 20,
          endingStack: 410,
          folded: false,
          gameSessionId: winnerSession.id,
          handId,
          holeCards: ["As", "Kd"],
          holeCardsPublic: false,
          netResult: 10,
          roomId: room.id,
          seatIndex: 1,
          startingStack: 400,
          userId: winner.userId,
        },
        {
          allIn: false,
          committed: 10,
          endingStack: 390,
          folded: true,
          gameSessionId: folderSession.id,
          handId,
          holeCards: ["Qc", "Jh"],
          holeCardsPublic: false,
          netResult: -10,
          roomId: room.id,
          seatIndex: 0,
          startingStack: 400,
          userId: folder.userId,
        },
      ],
    });
    await database.handPotRecord.create({
      data: {
        amount: 30,
        contributors: [winner.userId, folder.userId],
        eligiblePlayers: [winner.userId],
        handId,
        oddChipRecipients: [],
        potIndex: 0,
        winners: [winner.userId],
      },
    });

    const report = await runDataAudit(database);

    expect(report.checks.find((check) => check.code === "HAND_POT_AWARD_MISMATCH")).toEqual({
      code: "HAND_POT_AWARD_MISMATCH",
      count: 0,
      status: "PASS",
    });
    expect(report.ok).toBe(true);

    await database.handPotRecord.update({
      data: { amount: 20 },
      where: { handId_potIndex: { handId, potIndex: 0 } },
    });
    const legacyReturnReport = await runDataAudit(database);
    expect(legacyReturnReport.checks.find((check) => check.code === "HAND_POT_AWARD_MISMATCH")).toEqual({
      code: "HAND_POT_AWARD_MISMATCH",
      count: 1,
      status: "FAIL",
    });
    expect(legacyReturnReport.ok).toBe(false);
  });
});
