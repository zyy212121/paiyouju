import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseClient } from "../db/client.js";
import { clearIntegrationDatabase, createIntegrationDatabase, createTestIdentity } from "../integration/database.js";
import { createTableAccountingService } from "../modules/tables/table-accounting.service.js";
import { runDataAudit } from "./data-audit.js";
import { createDataRetentionService, DATA_RETENTION_DAYS } from "./data-retention.js";

const operation = (suffix: string) => `71717171-7171-4171-8171-${suffix.padStart(12, "0")}`;

describe("30-day application data retention", () => {
  let database: DatabaseClient;

  beforeAll(() => { database = createIntegrationDatabase(); });
  beforeEach(async () => clearIntegrationDatabase(database));
  afterAll(async () => database.$disconnect());

  it("purges expired closed-room history while preserving accounts, wallets, and recent rooms", async () => {
    const now = new Date("2026-08-27T12:00:00.000Z");
    const old = new Date(now.getTime() - (DATA_RETENTION_DAYS + 1) * 86_400_000);
    const recent = new Date(now.getTime() - 2 * 86_400_000);
    const identity = await createTestIdentity(database, "retained-user", 10_000);
    const oldRoom = await database.room.create({ data: { actionTimeSeconds: 30, bigBlind: 20, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "过期房间", ownerId: identity.userId, paidCardRevealCost: 50, paidCardRevealEnabled: true, roomCode: "717171", smallBlind: 10 } });
    await database.roomMember.create({ data: { role: "OWNER", roomId: oldRoom.id, userId: identity.userId } });
    const accounting = createTableAccountingService(database);
    await accounting.takeSeat(identity.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: operation("1"), roomId: oldRoom.id, seatIndex: 0 });
    await accounting.cashOut(identity.userId, { expectedStateVersion: 1, operationId: operation("2"), roomId: oldRoom.id });
    await database.room.update({ data: { closedAt: old, closeRequestedAt: old, status: "CLOSED" }, where: { id: oldRoom.id } });

    const recentRoom = await database.room.create({ data: { actionTimeSeconds: 30, bigBlind: 20, closedAt: recent, closeRequestedAt: recent, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "近期房间", ownerId: identity.userId, paidCardRevealCost: 50, paidCardRevealEnabled: true, roomCode: "727272", smallBlind: 10, status: "CLOSED" } });
    await database.roomMember.create({ data: { role: "OWNER", roomId: recentRoom.id, userId: identity.userId } });
    const initialGrant = await database.walletLedgerEntry.findFirstOrThrow({ where: { userId: identity.userId } });
    await database.walletLedgerEntry.update({ data: { createdAt: old }, where: { id: initialGrant.id } });
    const session = await database.userSession.findFirstOrThrow({ where: { userId: identity.userId } });
    await database.userSession.update({ data: { expiresAt: old }, where: { id: session.id } });
    await database.userSession.create({ data: { expiresAt: new Date(now.getTime() + 86_400_000), tokenHash: "a".repeat(64), userId: identity.userId } });
    await database.auditLog.create({ data: { action: "RETENTION_FIXTURE", actorRole: "USER", actorUserId: identity.userId, createdAt: old, requestId: operation("3"), targetType: "USER" } });

    const result = await createDataRetentionService(database, { clock: () => now }).runOnce();

    expect(result).toMatchObject({ closedRooms: 1, retentionDays: 30 });
    expect(await database.room.findUnique({ where: { id: oldRoom.id } })).toBeNull();
    expect(await database.room.findUnique({ where: { id: recentRoom.id } })).not.toBeNull();
    expect(await database.user.findUnique({ where: { id: identity.userId } })).not.toBeNull();
    expect(await database.wallet.findUnique({ where: { userId: identity.userId } })).toMatchObject({ balance: 10_000 });
    expect(await database.gameSession.count({ where: { roomId: oldRoom.id } })).toBe(0);
    expect(await database.tableStackLedgerEntry.count({ where: { roomId: oldRoom.id } })).toBe(0);
    expect(await database.userSession.count({ where: { userId: identity.userId } })).toBe(1);
    expect(await database.auditLog.count({ where: { actorUserId: identity.userId } })).toBe(0);
    expect(await database.walletLedgerEntry.count({ where: { id: initialGrant.id } })).toBe(0);
    expect((await runDataAudit(database)).ok).toBe(true);
  });
});
