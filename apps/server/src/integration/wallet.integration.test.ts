import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { loadEnvironment } from "../config/environment.js";
import type { DatabaseClient } from "../db/client.js";
import { createWalletService } from "../modules/wallet/wallet.service.js";
import { createTableAccountingService } from "../modules/tables/table-accounting.service.js";
import { clearIntegrationDatabase, createIntegrationDatabase, createTestIdentity } from "./database.js";

describe("wallet and ledger with PostgreSQL", () => {
  let database: DatabaseClient;

  beforeAll(() => {
    database = createIntegrationDatabase();
  });

  beforeEach(async () => {
    await clearIntegrationDatabase(database);
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  it("applies credits/debits with contiguous versions and ledger balances", async () => {
    const identity = await createTestIdentity(database, "alice", 10_000);
    const wallet = createWalletService(database);

    const credit = await wallet.applyWalletMutation({
      idempotencyKey: "admin-adjustment:credit",
      signedAmount: 500,
      type: "ADMIN_ADJUSTMENT",
      userId: identity.userId,
    });
    const debit = await wallet.applyWalletMutation({
      idempotencyKey: "admin-adjustment:debit",
      signedAmount: -750,
      type: "ADMIN_ADJUSTMENT",
      userId: identity.userId,
    });

    expect(credit).toMatchObject({ balanceAfter: 10_500, balanceBefore: 10_000, sequence: 2 });
    expect(debit).toMatchObject({ balanceAfter: 9_750, balanceBefore: 10_500, sequence: 3 });
    expect(await wallet.getWallet(identity.userId)).toMatchObject({ balance: 9_750, version: 3 });
    const entries = await database.walletLedgerEntry.findMany({ orderBy: { sequence: "asc" } });
    expect(entries.map(({ balanceAfter, balanceBefore, sequence }) => ({ balanceAfter, balanceBefore, sequence }))).toEqual([
      { balanceAfter: 10_000, balanceBefore: 0, sequence: 1 },
      { balanceAfter: 10_500, balanceBefore: 10_000, sequence: 2 },
      { balanceAfter: 9_750, balanceBefore: 10_500, sequence: 3 },
    ]);
  });

  it("rejects negative and over-maximum balances without partial writes", async () => {
    const identity = await createTestIdentity(database, "alice", 10_000);
    const wallet = createWalletService(database);

    await expect(wallet.applyWalletMutation({
      idempotencyKey: "admin-adjustment:too-low",
      signedAmount: -10_001,
      type: "ADMIN_ADJUSTMENT",
      userId: identity.userId,
    })).rejects.toMatchObject({ code: "WALLET_INSUFFICIENT_BALANCE" });

    await expect(wallet.applyWalletMutation({
      idempotencyKey: "admin-adjustment:too-high",
      signedAmount: 2_000_000_000,
      type: "ADMIN_ADJUSTMENT",
      userId: identity.userId,
    })).rejects.toMatchObject({ code: "WALLET_MAX_BALANCE_EXCEEDED" });

    expect(await database.wallet.findUniqueOrThrow({ where: { userId: identity.userId } })).toMatchObject({ balance: 10_000, version: 1 });
    expect(await database.walletLedgerEntry.count()).toBe(1);
  });

  it("replays identical keys and rejects changed payloads", async () => {
    const identity = await createTestIdentity(database, "alice", 10_000);
    const wallet = createWalletService(database);
    const input = {
      idempotencyKey: "admin-adjustment:replay",
      metadata: { reason: "test" },
      signedAmount: 50,
      type: "ADMIN_ADJUSTMENT" as const,
      userId: identity.userId,
    };

    const first = await wallet.applyWalletMutation(input);
    const replay = await wallet.applyWalletMutation(input);
    expect(replay).toEqual(first);
    expect(await database.walletLedgerEntry.count()).toBe(2);

    await expect(wallet.applyWalletMutation({ ...input, signedAmount: 51 })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await database.wallet.findUniqueOrThrow({ where: { userId: identity.userId } })).toMatchObject({ balance: 10_050, version: 2 });
  });

  it("rolls back its balance CAS if ledger insertion violates a foreign key", async () => {
    const identity = await createTestIdentity(database, "alice", 10_000);
    const wallet = createWalletService(database);

    await expect(wallet.applyWalletMutation({
      idempotencyKey: "paid-reveal:missing-room",
      relatedRoomId: "cm00000000000000000000000",
      signedAmount: -500,
      type: "PAID_CARD_REVEAL",
      userId: identity.userId,
    })).rejects.toBeInstanceOf(Error);

    expect(await database.wallet.findUniqueOrThrow({ where: { userId: identity.userId } })).toMatchObject({ balance: 10_000, version: 1 });
    expect(await database.walletLedgerEntry.count()).toBe(1);
  });

  it("does not lose updates under concurrent distinct requests", async () => {
    const identity = await createTestIdentity(database, "alice", 10_000);
    const wallet = createWalletService(database, { maxCasAttempts: 20 });

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        wallet.applyWalletMutation({
          idempotencyKey: `admin-adjustment:concurrent:${index}`,
          signedAmount: 10,
          type: "ADMIN_ADJUSTMENT",
          userId: identity.userId,
        }),
      ),
    );

    expect(results).toHaveLength(12);
    expect(await database.wallet.findUniqueOrThrow({ where: { userId: identity.userId } })).toMatchObject({ balance: 10_120, version: 13 });
    expect(await database.walletLedgerEntry.count()).toBe(13);
  });

  it("allows only one of two concurrent debits that cannot both be funded", async () => {
    const identity = await createTestIdentity(database, "alice", 100);
    const wallet = createWalletService(database, { maxCasAttempts: 20 });
    const settled = await Promise.allSettled([
      wallet.applyWalletMutation({ idempotencyKey: "admin-debit:a", signedAmount: -80, type: "ADMIN_ADJUSTMENT", userId: identity.userId }),
      wallet.applyWalletMutation({ idempotencyKey: "admin-debit:b", signedAmount: -80, type: "ADMIN_ADJUSTMENT", userId: identity.userId }),
    ]);

    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(settled.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(await database.wallet.findUniqueOrThrow({ where: { userId: identity.userId } })).toMatchObject({ balance: 20, version: 2 });
  });

  it("paginates newest-first and HTTP never accepts another user id", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const bob = await createTestIdentity(database, "bob", 10_000);
    const wallet = createWalletService(database);
    for (let index = 0; index < 4; index += 1) {
      await wallet.applyWalletMutation({
        idempotencyKey: `admin-adjustment:page:${index}`,
        ...(index === 3 ? { metadata: { card: "Qc", holeCards: ["As", "Kd"], internalNote: "never public" } } : {}),
        signedAmount: 1,
        type: "ADMIN_ADJUSTMENT",
        userId: alice.userId,
      });
    }
    const firstPage = await wallet.listLedger(alice.userId, { limit: 2 });
    const secondPage = await wallet.listLedger(alice.userId, { cursor: firstPage.nextCursor, limit: 2 });
    expect(firstPage.entries.map((entry) => entry.sequence)).toEqual([5, 4]);
    expect(secondPage.entries.map((entry) => entry.sequence)).toEqual([3, 2]);
    await database.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      await transaction.$executeRawUnsafe("SET LOCAL enable_sort = off");
      const plan = await transaction.$queryRaw<Array<{ readonly "QUERY PLAN": string }>>`
        EXPLAIN (FORMAT TEXT)
        SELECT * FROM "WalletLedgerEntry"
        WHERE "userId" = ${alice.userId} AND "sequence" < 999999
        ORDER BY "sequence" DESC
        LIMIT 25
      `;
      expect(plan.map((row) => row["QUERY PLAN"]).join("\n")).toContain("WalletLedgerEntry_userId_sequence_idx");
    });

    const app = await buildApp({ database, environment: loadEnvironment(), logger: false, rateLimit: false });
    const own = await app.inject({ headers: { cookie: alice.cookie }, method: "GET", url: `/api/wallet/ledger?limit=100&userId=${bob.userId}` });
    expect(own.statusCode).toBe(400);
    const valid = await app.inject({ headers: { cookie: alice.cookie }, method: "GET", url: "/api/wallet/ledger?limit=2" });
    expect(valid.statusCode).toBe(200);
    expect(valid.body).not.toContain(bob.userId);
    expect(valid.body).not.toMatch(/holeCards|internalNote|never public|admin-adjustment:page|As|Kd|Qc/u);
    const firstPublicEntry = valid.json().data.entries[0] as Record<string, unknown>;
    expect(Object.keys(firstPublicEntry).sort()).toEqual([
      "balanceAfter", "balanceBefore", "createdAt", "id", "relatedGameSessionId", "relatedHandId",
      "relatedRoomId", "sequence", "signedAmount", "type",
    ]);
    await app.close();
  });

  it("does not expose a public arbitrary mutation endpoint", async () => {
    const identity = await createTestIdentity(database, "alice", 10_000);
    const app = await buildApp({ database, environment: loadEnvironment(), logger: false, rateLimit: false });
    for (const path of ["add", "remove", "transfer"]) {
      const response = await app.inject({ headers: { cookie: identity.cookie, origin: "http://localhost:5173", "x-wepoker-request": "1" }, method: "POST", url: `/api/wallet/${path}` });
      expect(response.statusCode).toBe(404);
    }
    await app.close();
  });

  it("allows diamond adjustments while the user owns independent room points", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 30, bigBlind: 20, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "占座余额保护", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "818181", smallBlind: 10 } });
    await database.roomMember.create({ data: { role: "OWNER", roomId: room.id, userId: alice.userId } });
    await createTableAccountingService(database).takeSeat(alice.userId, {
      buyInAmount: 400,
      expectedStateVersion: 0,
      operationId: "81818181-8181-4818-8818-181818181818",
      roomId: room.id,
      seatIndex: 0,
    });
    const wallet = createWalletService(database);

    await expect(wallet.applyWalletMutation({
      idempotencyKey: "occupied-positive-adjustment",
      signedAmount: 1,
      type: "ADMIN_ADJUSTMENT",
      userId: alice.userId,
    })).resolves.toMatchObject({ balanceAfter: 10_001 });

    expect(await database.wallet.findUniqueOrThrow({ where: { userId: alice.userId } })).toMatchObject({ balance: 10_001 });
  });
});
