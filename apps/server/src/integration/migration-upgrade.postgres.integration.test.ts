import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

import { loadEnvironment } from "../config/environment.js";

const migrationsDirectory = fileURLToPath(
  new URL("../../prisma/migrations/", import.meta.url),
);

const upgradeStages = [
  { appliedMigrations: 2, name: "Step 3" },
  { appliedMigrations: 8, name: "Step 4" },
  { appliedMigrations: 9, name: "Step 5" },
  { appliedMigrations: 10, name: "Step 6" },
  { appliedMigrations: 11, name: "Step 6.5" },
  { appliedMigrations: 17, name: "Step 7" },
] as const;

function quotedIdentifier(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) throw new Error("unsafe test schema identifier");
  return `"${value}"`;
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let statementStart = 0;
  let index = 0;
  let dollarTag: string | undefined;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (index < sql.length) {
    if (dollarTag !== undefined) {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length;
        dollarTag = undefined;
      } else {
        index += 1;
      }
      continue;
    }

    if (inLineComment) {
      if (sql[index] === "\n") inLineComment = false;
      index += 1;
      continue;
    }

    if (inBlockComment) {
      if (sql.startsWith("*/", index)) {
        index += 2;
        inBlockComment = false;
      } else {
        index += 1;
      }
      continue;
    }

    if (inSingleQuote) {
      if (sql[index] === "'" && sql[index + 1] === "'") {
        index += 2;
      } else {
        if (sql[index] === "'") inSingleQuote = false;
        index += 1;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (sql[index] === '"' && sql[index + 1] === '"') {
        index += 2;
      } else {
        if (sql[index] === '"') inDoubleQuote = false;
        index += 1;
      }
      continue;
    }

    if (sql.startsWith("--", index)) {
      inLineComment = true;
      index += 2;
      continue;
    }
    if (sql.startsWith("/*", index)) {
      inBlockComment = true;
      index += 2;
      continue;
    }
    if (sql[index] === "'") {
      inSingleQuote = true;
      index += 1;
      continue;
    }
    if (sql[index] === '"') {
      inDoubleQuote = true;
      index += 1;
      continue;
    }
    if (sql[index] === "$") {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(sql.slice(index))?.[0];
      if (tag !== undefined) {
        dollarTag = tag;
        index += tag.length;
        continue;
      }
    }
    if (sql[index] === ";") {
      const statement = sql.slice(statementStart, index).trim();
      if (statement.length > 0) statements.push(statement);
      statementStart = index + 1;
    }
    index += 1;
  }

  const finalStatement = sql.slice(statementStart).trim();
  if (finalStatement.length > 0) statements.push(finalStatement);
  return statements;
}

async function runMigrationStatements(client: Client, sql: string): Promise<void> {
  for (const statement of splitSqlStatements(sql)) {
    await client.query(statement);
  }
}

describe("Step 4 through current PostgreSQL migrations", () => {
  it("backfills hand allocation, reveal policy, and deterministic full boards", async () => {
    const environment = loadEnvironment();
    const client = new Client({ connectionString: environment.DATABASE_URL });
    const schema = `step5_upgrade_${randomUUID().replaceAll("-", "")}`;
    const quotedSchema = quotedIdentifier(schema);
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA ${quotedSchema}`);
      await client.query(`SET search_path TO ${quotedSchema}`);
      const migrationNames = (await readdir(migrationsDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      expect(migrationNames).toHaveLength(34);

      for (const migrationName of migrationNames.slice(0, 8)) {
        const sql = await readFile(
          new URL(`${migrationName}/migration.sql`, new URL("../../prisma/migrations/", import.meta.url)),
          "utf8",
        );
        await client.query(sql);
      }

      await client.query(`
        INSERT INTO "User" (
          "id", "username", "usernameNormalized", "nickname", "passwordHash", "createdAt", "updatedAt"
        ) VALUES (
          'upgrade-owner', 'upgrade_owner', 'upgrade_owner', 'Upgrade Owner', 'test-only', NOW(), NOW()
        )
      `);
      await client.query(`
        INSERT INTO "Room" (
          "id", "roomCode", "name", "ownerId", "maxSeats", "smallBlind", "bigBlind",
          "minimumBuyIn", "maximumBuyIn", "actionTimeSeconds", "paidCardRevealEnabled",
          "paidCardRevealCost", "nextHandPaused", "status", "createdAt", "updatedAt"
        ) VALUES (
          'upgrade-room', '424242', 'Upgrade Room', 'upgrade-owner', 2, 10, 20,
          400, 400, 15, FALSE, 0, FALSE, 'OPEN', NOW(), NOW()
        )
      `);
      await client.query(`
        INSERT INTO "HandRecord" (
          "id", "roomId", "handNumber", "buttonSeat", "smallBlindSeat", "bigBlindSeat",
          "smallBlindAmount", "bigBlindAmount", "board", "finishReason", "startedAt", "finishedAt"
        ) VALUES (
          'upgrade-hand-41', 'upgrade-room', 41, 0, 0, 1, 10, 20,
          ARRAY[]::TEXT[], 'FOLD_TO_WIN', NOW() - INTERVAL '1 second', NOW()
        )
      `);

      const step5Sql = await readFile(
        new URL(`${migrationNames[8]}/migration.sql`, new URL("../../prisma/migrations/", import.meta.url)),
        "utf8",
      );
      await client.query(step5Sql);
      const result = await client.query<{ nextHandNumber: number }>(
        `SELECT "nextHandNumber" FROM "Room" WHERE "id" = 'upgrade-room'`,
      );

      expect(result.rows).toEqual([{ nextHandNumber: 42 }]);

      const step6Sql = await readFile(
        new URL(`${migrationNames[9]}/migration.sql`, new URL("../../prisma/migrations/", import.meta.url)),
        "utf8",
      );
      await client.query(step6Sql);
      const legacyHand = await client.query<{ paidCardRevealCost: number; paidCardRevealEnabled: boolean }>(
        `SELECT "paidCardRevealCost", "paidCardRevealEnabled" FROM "HandRecord" WHERE "id" = 'upgrade-hand-41'`,
      );
      expect(legacyHand.rows).toEqual([{ paidCardRevealCost: 0, paidCardRevealEnabled: false }]);
      const paidRevealTable = await client.query<{ name: string }>(`
        SELECT to_regclass('"PaidCardReveal"')::TEXT AS name
      `);
      expect(paidRevealTable.rows).toEqual([{ name: '"PaidCardReveal"' }]);
      const historyIndexes = await client.query<{ indexname: string }>(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname IN (
            'GameSession_userId_startedAt_idx',
            'GameSession_userId_startedAt_id_idx',
            'HandRecord_roomId_finishedAt_idx',
            'HandRecord_roomId_finishedAt_id_idx',
            'HandPlayerRecord_userId_createdAt_idx',
            'HandPlayerRecord_userId_createdAt_handId_idx',
            'TableStackLedgerEntry_userId_createdAt_idx',
            'TableStackLedgerEntry_userId_createdAt_handId_idx',
            'WalletLedgerEntry_userId_sequence_idx'
          )
        ORDER BY indexname
      `);
      expect(historyIndexes.rows.map((row) => row.indexname)).toEqual([
        "GameSession_userId_startedAt_id_idx",
        "HandPlayerRecord_userId_createdAt_handId_idx",
        "HandRecord_roomId_finishedAt_id_idx",
        "TableStackLedgerEntry_userId_createdAt_handId_idx",
        "WalletLedgerEntry_userId_sequence_idx",
      ]);

      const step65Sql = await readFile(
        new URL(`${migrationNames[10]}/migration.sql`, new URL("../../prisma/migrations/", import.meta.url)),
        "utf8",
      );
      await client.query(step65Sql);
      const upgraded = await client.query<{
        phoneNumber: string | null;
        remainingDeck: string[];
        requiresManualStart: boolean;
        reviewEndsAt: Date | null;
      }>(`
        SELECT u."phoneNumber", h."remainingDeck", r."requiresManualStart", h."reviewEndsAt"
        FROM "User" u
        JOIN "Room" r ON r."ownerId" = u."id"
        JOIN "HandRecord" h ON h."roomId" = r."id"
        WHERE h."id" = 'upgrade-hand-41'
      `);
      expect(upgraded.rows).toEqual([{
        phoneNumber: null,
        remainingDeck: [],
        requiresManualStart: true,
        reviewEndsAt: null,
      }]);
      const newTables = await client.query<{ name: string }>(`
        SELECT to_regclass('"PaidHandRevealPurchase"')::TEXT AS name
        UNION ALL
        SELECT to_regclass('"HandHypotheticalRunout"')::TEXT AS name
        ORDER BY name
      `);
      expect(newTables.rows.map((row) => row.name)).toEqual([
        '"HandHypotheticalRunout"',
        '"PaidHandRevealPurchase"',
      ]);

      await client.query(`
        UPDATE "HandRecord"
        SET "board" = ARRAY['As', 'Kd', 'Qc']::TEXT[],
            "remainingDeck" = ARRAY['Jh', 'Ts']::TEXT[]
        WHERE "id" = 'upgrade-hand-41'
      `);
      const uiIssueFixesSql = await readFile(
        new URL(`${migrationNames[11]}/migration.sql`, new URL("../../prisma/migrations/", import.meta.url)),
        "utf8",
      );
      await client.query(uiIssueFixesSql);
      const deterministicRunout = await client.query<{ fullBoard: string[] }>(`
        SELECT "fullBoard"
        FROM "HandRecord"
        WHERE "id" = 'upgrade-hand-41'
      `);
      expect(deterministicRunout.rows).toEqual([{
        fullBoard: ["As", "Kd", "Qc", "Jh", "Ts"],
      }]);
      const perCardRevealSql = await readFile(
        new URL(`${migrationNames[12]}/migration.sql`, new URL("../../prisma/migrations/", import.meta.url)),
        "utf8",
      );
      await client.query(perCardRevealSql);
      const revealSlots = await client.query<{ voluntarilyRevealedCardIndices: number[] }>(`
        SELECT "voluntarilyRevealedCardIndices"
        FROM "HandPlayerRecord"
        WHERE "handId" = 'upgrade-hand-41'
        ORDER BY "seatIndex"
      `);
      expect(revealSlots.rows.every((row) => row.voluntarilyRevealedCardIndices.length === 0)).toBe(true);
      const autoCallSql = await readFile(
        new URL(`${migrationNames[13]}/migration.sql`, new URL("../../prisma/migrations/", import.meta.url)),
        "utf8",
      );
      await client.query(autoCallSql);
      const autoCallAuthority = await client.query<{ columnName: string; enumValue: string }>(`
        SELECT column_name AS "columnName", 'NEXT_DECISION_AUTO_CALL'::"HandActionAutomaticReason"::TEXT AS "enumValue"
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'TableSeat'
          AND column_name = 'nextActionAutoCallCurrentBet'
      `);
      expect(autoCallAuthority.rows).toEqual([{ columnName: "nextActionAutoCallCurrentBet", enumValue: "NEXT_DECISION_AUTO_CALL" }]);

      const roomClockSql = await readFile(
        new URL(`${migrationNames[14]}/migration.sql`, new URL("../../prisma/migrations/", import.meta.url)),
        "utf8",
      );
      // Prisma executes PostgreSQL migration statements separately. Preserve the
      // enum commit boundary here so the upgrade harness matches migrate deploy.
      await runMigrationStatements(client, roomClockSql);
      const roomClock = await client.query<{
        actionTimeSeconds: number;
        durationMinutes: number;
        paidCardRevealCost: number;
        paidCardRevealEnabled: boolean;
      }>(`
        SELECT "actionTimeSeconds", "durationMinutes", "paidCardRevealCost", "paidCardRevealEnabled"
        FROM "Room" WHERE "id" = 'upgrade-room'
      `);
      expect(roomClock.rows).toEqual([{
        actionTimeSeconds: 15,
        durationMinutes: 60,
        paidCardRevealCost: 10,
        paidCardRevealEnabled: true,
      }]);
      await client.query(`UPDATE "Room" SET "expiresAt" = NOW() - INTERVAL '1 minute' WHERE "id" = 'upgrade-room'`);

      const roomClockCompatibilitySql = await readFile(
        new URL(`${migrationNames[15]}/migration.sql`, new URL("../../prisma/migrations/", import.meta.url)),
        "utf8",
      );
      await client.query(roomClockCompatibilitySql);
      const compatibility = await client.query<{ expiryIsFuture: boolean }>(`
        SELECT "expiresAt" > NOW() + INTERVAL '59 minutes' AS "expiryIsFuture"
        FROM "Room" WHERE "id" = 'upgrade-room'
      `);
      expect(compatibility.rows).toEqual([{ expiryIsFuture: true }]);

      const step7AdminAuditSql = await readFile(
        new URL(`${migrationNames[16]}/migration.sql`, new URL("../../prisma/migrations/", import.meta.url)),
        "utf8",
      );
      await runMigrationStatements(client, step7AdminAuditSql);
      const adminAuditContract = await client.query<{ auditLogTable: string; idempotencyScope: string }>(`
        SELECT
          to_regclass('"AuditLog"')::TEXT AS "auditLogTable",
          'ADMIN_WALLET_ADJUSTMENT'::"IdempotencyScope"::TEXT AS "idempotencyScope"
      `);
      expect(adminAuditContract.rows).toEqual([{
        auditLogTable: '"AuditLog"',
        idempotencyScope: "ADMIN_WALLET_ADJUSTMENT",
      }]);

      const step8ActionTimeSql = await readFile(
        new URL(`${migrationNames[17]}/migration.sql`, new URL("../../prisma/migrations/", import.meta.url)),
        "utf8",
      );
      await client.query(step8ActionTimeSql);
      const actionTimeConstraints = await client.query<{ name: string }>(`
        SELECT conname AS name
        FROM pg_constraint
        WHERE conrelid = '"Room"'::regclass
          AND conname IN ('Room_action_time_check', 'Room_actionTimeSeconds_range_step_check')
        ORDER BY conname
      `);
      expect(actionTimeConstraints.rows).toEqual([{ name: "Room_actionTimeSeconds_range_step_check" }]);
    } finally {
      await client.query("SET search_path TO public").catch(() => undefined);
      await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`).catch(() => undefined);
      await client.end();
    }
  });

  it.each(upgradeStages)("upgrades a $name legacy fixture through the current migration", async ({ appliedMigrations, name }) => {
    const environment = loadEnvironment();
    const client = new Client({ connectionString: environment.DATABASE_URL });
    const schema = `matrix_${name.replace(".", "_").toLowerCase().replace(" ", "_")}_${randomUUID().replaceAll("-", "")}`;
    const quotedSchema = quotedIdentifier(schema);
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA ${quotedSchema}`);
      await client.query(`SET search_path TO ${quotedSchema}`);
      const migrationNames = (await readdir(migrationsDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      expect(migrationNames).toHaveLength(34);

      for (const migrationName of migrationNames.slice(0, appliedMigrations)) {
        const sql = await readFile(
          new URL(`${migrationName}/migration.sql`, new URL("../../prisma/migrations/", import.meta.url)),
          "utf8",
        );
        await runMigrationStatements(client, sql);
      }

      await client.query(`
        INSERT INTO "User" (
          "id", "username", "usernameNormalized", "nickname", "passwordHash", "createdAt", "updatedAt"
        ) VALUES (
          'matrix-owner', 'legacy_owner', 'legacy_owner', 'Legacy Owner', 'test-only', NOW(), NOW()
        )
      `);
      await client.query(`
        INSERT INTO "Wallet" ("id", "userId", "balance", "version", "createdAt", "updatedAt")
        VALUES ('matrix-wallet', 'matrix-owner', 100, 0, NOW(), NOW())
      `);
      await client.query(`
        INSERT INTO "WalletLedgerEntry" (
          "id", "walletId", "userId", "sequence", "type", "signedAmount", "balanceBefore",
          "balanceAfter", "idempotencyKey", "requestFingerprint", "createdAt"
        ) VALUES (
          'matrix-grant', 'matrix-wallet', 'matrix-owner', 1, 'INITIAL_GRANT', 100, 0,
          100, 'matrix:initial-grant', 'matrix-fixture', NOW()
        )
      `);
      await client.query(`
        INSERT INTO "Room" (
          "id", "roomCode", "name", "ownerId", "maxSeats", "smallBlind", "bigBlind",
          "minimumBuyIn", "maximumBuyIn", "actionTimeSeconds", "paidCardRevealEnabled",
          "paidCardRevealCost", "nextHandPaused", "status", "createdAt", "updatedAt"
        ) VALUES (
          'matrix-room', '818181', 'Legacy Open Room', 'matrix-owner', 2, 10, 20,
          400, 2000, 15, FALSE, 0, FALSE, 'OPEN', NOW() - INTERVAL '2 hours', NOW()
        )
      `);
      await client.query(`
        INSERT INTO "RoomMember" (
          "id", "roomId", "userId", "role", "joinedAt", "createdAt", "updatedAt"
        ) VALUES (
          'matrix-member', 'matrix-room', 'matrix-owner', 'OWNER', NOW(), NOW(), NOW()
        )
      `);

      for (const migrationName of migrationNames.slice(appliedMigrations)) {
        const sql = await readFile(
          new URL(`${migrationName}/migration.sql`, new URL("../../prisma/migrations/", import.meta.url)),
          "utf8",
        );
        await runMigrationStatements(client, sql);
      }

      const fixture = await client.query<{
        actionTimeSeconds: number;
        balance: number;
        durationMinutes: number;
        expiryIsFuture: boolean;
        ledgerBalanceAfter: number;
        phoneNumber: string | null;
        requiresManualStart: boolean;
      }>(`
        SELECT
          r."actionTimeSeconds",
          w."balance",
          r."durationMinutes",
          r."expiresAt" > NOW() + INTERVAL '59 minutes' AS "expiryIsFuture",
          l."balanceAfter" AS "ledgerBalanceAfter",
          u."phoneNumber",
          r."requiresManualStart"
        FROM "User" u
        JOIN "Wallet" w ON w."userId" = u."id"
        JOIN "WalletLedgerEntry" l ON l."walletId" = w."id"
        JOIN "Room" r ON r."ownerId" = u."id"
        WHERE u."id" = 'matrix-owner'
      `);
      expect(fixture.rows).toEqual([{
        actionTimeSeconds: 15,
        balance: 100,
        durationMinutes: 60,
        expiryIsFuture: true,
        ledgerBalanceAfter: 100,
        phoneNumber: null,
        requiresManualStart: true,
      }]);

      await client.query(`UPDATE "Room" SET "actionTimeSeconds" = 10 WHERE "id" = 'matrix-room'`);
      const contract = await client.query<{ auditLog: string; obsoleteActionTimeConstraint: string | null; snapshot: string }>(`
        SELECT
          to_regclass('"AuditLog"')::TEXT AS "auditLog",
          (SELECT conname FROM pg_constraint WHERE conname = 'Room_action_time_check') AS "obsoleteActionTimeConstraint",
          to_regclass('"TableSnapshot"')::TEXT AS snapshot
      `);
      expect(contract.rows).toEqual([{
        auditLog: '"AuditLog"',
        obsoleteActionTimeConstraint: null,
        snapshot: '"TableSnapshot"',
      }]);
    } finally {
      await client.query("SET search_path TO public").catch(() => undefined);
      await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`).catch(() => undefined);
      await client.end();
    }
  });
});
