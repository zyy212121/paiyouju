import { createDatabaseClient, type DatabaseClient } from "../db/client.js";
import { createHash } from "node:crypto";

import { loadEnvironment } from "../config/environment.js";
import { hashSessionToken, sessionExpiresAt } from "../security/sessions.js";

export function createIntegrationDatabase(): DatabaseClient {
  const environment = loadEnvironment();
  return createDatabaseClient(
    environment.DATABASE_URL,
    environment.DATABASE_POOL_MAX,
  );
}

export async function createTestIdentity(
  database: DatabaseClient,
  username: string,
  initialBalance: number,
): Promise<{ readonly cookie: string; readonly rawToken: string; readonly userId: string }> {
  const rawToken = `test-${username}-${"x".repeat(32)}`;
  const result = await database.$transaction(async (transaction) => {
    const user = await transaction.user.create({
      data: {
        nickname: username,
        passwordHash: "$argon2id$test-only-fixture",
        username,
        usernameNormalized: username.toLowerCase(),
      },
    });
    const wallet = await transaction.wallet.create({
      data: { balance: initialBalance, userId: user.id, version: 1 },
    });
    await transaction.walletLedgerEntry.create({
      data: {
        balanceAfter: initialBalance,
        balanceBefore: 0,
        idempotencyKey: `initial-grant:${user.id}`,
        requestFingerprint: createHash("sha256").update(`${user.id}:${initialBalance}`).digest("hex"),
        sequence: 1,
        signedAmount: initialBalance,
        type: "INITIAL_GRANT",
        userId: user.id,
        walletId: wallet.id,
      },
    });
    await transaction.userSession.create({
      data: {
        expiresAt: sessionExpiresAt(),
        tokenHash: hashSessionToken(rawToken),
        userId: user.id,
      },
    });
    return user;
  });
  return { cookie: `wepoker_session=${rawToken}`, rawToken, userId: result.id };
}

export async function clearIntegrationDatabase(database: DatabaseClient): Promise<void> {
  await database.auditLog.deleteMany();
  await database.tableActionReceipt.deleteMany();
  await database.tableSnapshot.deleteMany();
  await database.paidCardReveal.deleteMany();
  await database.paidHandRevealPurchase.deleteMany();
  await database.hypotheticalRunoutPurchase.deleteMany();
  await database.handHypotheticalRunout.deleteMany();
  await database.handRunoutPotRecord.deleteMany();
  await database.handRunoutRecord.deleteMany();
  await database.handPotRecord.deleteMany();
  await database.handActionRecord.deleteMany();
  await database.tableStackLedgerEntry.deleteMany();
  await database.handPlayerRecord.deleteMany();
  await database.requestIdempotency.deleteMany();
  await database.walletLedgerEntry.deleteMany();
  await database.handRecord.deleteMany();
  await database.tableSeat.deleteMany();
  await database.gameSession.deleteMany();
  await database.roomMember.deleteMany();
  await database.room.deleteMany();
  await database.userSession.deleteMany();
  await database.wallet.deleteMany();
  await database.user.deleteMany();
}
