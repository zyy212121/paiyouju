import dotenv from "dotenv";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { loadEnvironment, MAX_POINTS, type Environment } from "../src/config/environment.js";
import { createDatabaseClient, type DatabaseClient } from "../src/db/client.js";
import { hashPassword } from "../src/security/passwords.js";

const SEED_USERS = [
  { avatarId: "avatar-01", isTestBot: false, nickname: "管理员", ordinal: null, phoneNumber: "19900000001", role: "ADMIN" as const, username: "admin" },
  ...Array.from({ length: 9 }, (_, index) => ({
    avatarId: `avatar-${String(index + 2).padStart(2, "0")}`,
    isTestBot: true,
    nickname: `机器人 ${String(index + 1).padStart(2, "0")}`,
    ordinal: index + 1,
    phoneNumber: null,
    role: "USER" as const,
    username: `bot${String(index + 1).padStart(2, "0")}`,
  })),
] as const;

export async function seedDatabase(database: DatabaseClient, environment: Environment) {
  if (environment.NODE_ENV === "production") {
    throw new Error("development seed is disabled in production");
  }
  if (!environment.DEV_SEED_PASSWORD) {
    throw new Error("DEV_SEED_PASSWORD is required for the development seed");
  }
  const seedPassword = environment.DEV_SEED_PASSWORD;
  const botPassword = environment.BOT_ACCOUNT_PASSWORD ?? seedPassword;

  let created = 0;
  let existing = 0;
  for (const seed of SEED_USERS) {
    const username = seed.role === "ADMIN" ? environment.ADMIN_USERNAME : seed.username;
    const usernameNormalized = username.toLowerCase();
    const found = await database.user.findUnique({ where: { usernameNormalized } });
    if (found) {
      await database.$transaction(async (transaction) => {
        await transaction.user.update({
          data: {
            avatarId: seed.avatarId,
            isTestBot: seed.isTestBot,
            nickname: seed.role === "ADMIN" ? environment.ADMIN_NICKNAME : seed.nickname,
            passwordHash: await hashPassword(seed.isTestBot ? botPassword : seedPassword),
            phoneNumber: seed.phoneNumber,
            role: seed.role,
            testBotLeaseExpiresAt: null,
            testBotLeaseId: null,
            testBotOrdinal: seed.ordinal,
          },
          where: { id: found.id },
        });
        if (seed.isTestBot) {
          const wallet = await transaction.wallet.findUniqueOrThrow({ where: { userId: found.id } });
          const refill = MAX_POINTS - wallet.balance;
          if (refill > 0) {
            await transaction.wallet.update({
              data: { balance: MAX_POINTS, version: { increment: 1 } },
              where: { id: wallet.id },
            });
            await transaction.walletLedgerEntry.create({
              data: {
                balanceAfter: MAX_POINTS,
                balanceBefore: wallet.balance,
                idempotencyKey: `test-bot-seed-refill:${found.id}:${String(wallet.version + 1)}`,
                metadata: { source: "development-seed" },
                requestFingerprint: createHash("sha256").update(`${found.id}:${String(wallet.version + 1)}:${String(refill)}`).digest("hex"),
                sequence: wallet.version + 1,
                signedAmount: refill,
                type: "ADMIN_ADJUSTMENT",
                userId: found.id,
                walletId: wallet.id,
              },
            });
          }
        }
      });
      existing += 1;
      continue;
    }

    const passwordHash = await hashPassword(seed.isTestBot ? botPassword : seedPassword);
    const nickname = seed.role === "ADMIN" ? environment.ADMIN_NICKNAME : seed.nickname;
    const initialBalance = seed.isTestBot ? MAX_POINTS : environment.INITIAL_USER_POINTS;
    await database.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          avatarId: seed.avatarId,
          isTestBot: seed.isTestBot,
          nickname,
          passwordHash,
          phoneNumber: seed.phoneNumber,
          role: seed.role,
          testBotOrdinal: seed.ordinal,
          username,
          usernameNormalized,
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
          requestFingerprint: createHash("sha256")
            .update(JSON.stringify({ amount: initialBalance, type: "INITIAL_GRANT", userId: user.id }))
            .digest("hex"),
          sequence: 1,
          signedAmount: initialBalance,
          type: "INITIAL_GRANT",
          userId: user.id,
          walletId: wallet.id,
        },
      });
    });
    created += 1;
  }
  return { created, existing };
}

async function run(): Promise<void> {
  dotenv.config({
    path:
      process.env.WEPOKER_ENV_FILE ??
      fileURLToPath(new URL("../../../.env", import.meta.url)),
    quiet: true,
  });
  const environment = loadEnvironment();
  const database = createDatabaseClient(
    environment.DATABASE_URL,
    environment.DATABASE_POOL_MAX,
  );
  try {
    const result = await seedDatabase(database, environment);
    process.stdout.write(
      `Development seed complete: created=${result.created}, existing=${result.existing}\n`,
    );
  } finally {
    await database.$disconnect();
  }
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  await run();
}
