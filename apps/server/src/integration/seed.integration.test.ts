import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { seedDatabase } from "../../prisma/seed.js";
import { loadEnvironment } from "../config/environment.js";
import type { DatabaseClient } from "../db/client.js";
import { createWalletService } from "../modules/wallet/wallet.service.js";
import { verifyPassword } from "../security/passwords.js";
import { clearIntegrationDatabase, createIntegrationDatabase } from "./database.js";

describe("development seed with PostgreSQL", () => {
  let database: DatabaseClient;

  beforeAll(() => {
    database = createIntegrationDatabase();
  });
  beforeEach(async () => clearIntegrationDatabase(database));
  afterAll(async () => database.$disconnect());

  it("is idempotent, repairs the local admin and fixed bots, and refills bot diamonds", async () => {
    const environment = loadEnvironment();
    const first = await seedDatabase(database, environment);
    expect(first).toEqual({ created: 10, existing: 0 });

    const bot = await database.user.findUniqueOrThrow({ where: { usernameNormalized: "bot01" } });
    await database.user.update({ where: { id: bot.id }, data: { passwordHash: "$argon2id$broken-local-bot" } });
    const admin = await database.user.findUniqueOrThrow({ where: { usernameNormalized: "admin" } });
    await database.user.update({ where: { id: admin.id }, data: { passwordHash: "$argon2id$broken-local-admin" } });
    const wallet = createWalletService(database);
    await wallet.applyWalletMutation({
      idempotencyKey: "admin-adjustment:seed-bot-refill",
      signedAmount: -50,
      type: "ADMIN_ADJUSTMENT",
      userId: bot.id,
    });

    const second = await seedDatabase(database, environment);
    expect(second).toEqual({ created: 0, existing: 10 });
    expect(await database.user.count()).toBe(10);
    expect(await database.wallet.count()).toBe(10);
    expect(await database.walletLedgerEntry.count({ where: { type: "INITIAL_GRANT" } })).toBe(10);
    const repairedBot = await database.user.findUniqueOrThrow({ where: { id: bot.id } });
    expect(repairedBot).toMatchObject({ isTestBot: true, role: "USER", testBotOrdinal: 1 });
    expect(await verifyPassword(repairedBot.passwordHash, environment.BOT_ACCOUNT_PASSWORD ?? environment.DEV_SEED_PASSWORD!)).toBe(true);
    expect(await database.wallet.findUniqueOrThrow({ where: { userId: bot.id } })).toMatchObject({ balance: 2_000_000_000, version: 3 });
    const repairedAdmin = await database.user.findUniqueOrThrow({ where: { usernameNormalized: "admin" } });
    expect(repairedAdmin).toMatchObject({ phoneNumber: "19900000001", role: "ADMIN" });
    expect(await verifyPassword(repairedAdmin.passwordHash, environment.DEV_SEED_PASSWORD!)).toBe(true);
    expect(await database.user.count({ where: { role: "ADMIN" } })).toBe(1);
    const bots = await database.user.findMany({
      orderBy: { testBotOrdinal: "asc" },
      where: { isTestBot: true },
    });
    expect(bots.map((bot) => [bot.username, bot.testBotOrdinal])).toEqual(
      Array.from({ length: 9 }, (_, index) => [`bot${String(index + 1).padStart(2, "0")}`, index + 1]),
    );
    expect(await database.wallet.count({ where: { balance: 2_000_000_000, user: { isTestBot: true } } })).toBe(9);
  });

  it("refuses to create fixed accounts in production", async () => {
    const environment = loadEnvironment();
    await expect(seedDatabase(database, { ...environment, NODE_ENV: "production" })).rejects.toThrow("development seed is disabled in production");
    expect(await database.user.count()).toBe(0);
  });
});
