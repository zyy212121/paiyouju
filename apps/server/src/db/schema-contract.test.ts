import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const schemaPath = fileURLToPath(
  new URL("../../prisma/schema.prisma", import.meta.url),
);
const legacyRoomNormalizationPath = fileURLToPath(
  new URL("../../prisma/migrations/20260813214900_step4_legacy_room_points_normalization/migration.sql", import.meta.url),
);
const step5MigrationPath = fileURLToPath(
  new URL("../../prisma/migrations/20260814013000_step5_durable_table_recovery/migration.sql", import.meta.url),
);
const step6MigrationPath = fileURLToPath(
  new URL("../../prisma/migrations/20260820090000_step6_history_paid_reveal/migration.sql", import.meta.url),
);
const step65MigrationPath = fileURLToPath(
  new URL("../../prisma/migrations/20260824120000_step6_5_mobile_lifecycle/migration.sql", import.meta.url),
);
const uiIssueFixesMigrationPath = fileURLToPath(
  new URL("../../prisma/migrations/20260824170000_ui_issue_fixes/migration.sql", import.meta.url),
);
const perCardRevealMigrationPath = fileURLToPath(
  new URL("../../prisma/migrations/20260824200000_per_card_voluntary_reveal/migration.sql", import.meta.url),
);
const autoCallMigrationPath = fileURLToPath(
  new URL("../../prisma/migrations/20260824203000_next_action_auto_call/migration.sql", import.meta.url),
);
const roomClockMigrationPath = fileURLToPath(
  new URL("../../prisma/migrations/20260825030000_room_clock_show_fees/migration.sql", import.meta.url),
);
const roomClockCompatibilityMigrationPath = fileURLToPath(
  new URL("../../prisma/migrations/20260825033000_existing_room_clock_compat/migration.sql", import.meta.url),
);
const step7AdminAuditMigrationPath = fileURLToPath(
  new URL("../../prisma/migrations/20260825100000_step7_admin_audit/migration.sql", import.meta.url),
);
const step8ActionTimeConstraintFixPath = fileURLToPath(
  new URL("../../prisma/migrations/20260826010000_step8_action_time_constraint_fix/migration.sql", import.meta.url),
);
const roomPointsRetentionMigrationPath = fileURLToPath(
  new URL("../../prisma/migrations/20260827190000_decouple_table_points_retention/migration.sql", import.meta.url),
);
const diagnosticTraceMigrationPath = fileURLToPath(
  new URL("../../prisma/migrations/20260827230000_table_diagnostic_trace/migration.sql", import.meta.url),
);
const localAdministratorLogsMigrationPath = fileURLToPath(
  new URL("../../prisma/migrations/20260829010000_admin_cleanup_fixed_bots_local_logs/migration.sql", import.meta.url),
);
const roomStackContinuityMigrationPath = fileURLToPath(
  new URL("../../prisma/migrations/20260828010000_room_stack_continuity/migration.sql", import.meta.url),
);
const squidModeMigrationPath = fileURLToPath(
  new URL("../../prisma/migrations/20260830100000_squid_mode_and_trusteeship/migration.sql", import.meta.url),
);
const squidLedgerGuardMigrationPath = fileURLToPath(
  new URL("../../prisma/migrations/20260830101000_squid_settlement_ledger_guard/migration.sql", import.meta.url),
);
const runItTwiceMigrationPath = fileURLToPath(
  new URL("../../prisma/migrations/20260830130000_run_it_twice/migration.sql", import.meta.url),
);
const avatarLibraryMigrationPath = fileURLToPath(
  new URL("../../prisma/migrations/20260830233000_user_avatar_library/migration.sql", import.meta.url),
);
const bombPotEnumMigrationPath = fileURLToPath(
  new URL("../../prisma/migrations/20260831030000_bomb_pot_mode_enum/migration.sql", import.meta.url),
);
const bombPotRulesMigrationPath = fileURLToPath(
  new URL("../../prisma/migrations/20260831031000_bomb_pot_mode_rules/migration.sql", import.meta.url),
);

describe("Step 4 Prisma schema contract", () => {
  it("defines the required account, table and completed-hand models", async () => {
    const schema = await readFile(schemaPath, "utf8");

    for (const model of [
      "User",
      "UserSession",
      "Wallet",
      "WalletLedgerEntry",
      "Room",
      "RoomMember",
      "RequestIdempotency",
      "TableSeat",
      "GameSession",
      "TableStackLedgerEntry",
      "HandRecord",
      "HandPlayerRecord",
      "HandActionRecord",
      "HandPotRecord",
      "HandRunoutRecord",
      "HandRunoutPotRecord",
      "PaidCardReveal",
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }

    for (const deferredModel of [
      "TableRuntime",
      "AdminOperation",
    ]) {
      expect(schema).not.toContain(`model ${deferredModel} {`);
    }
  });

  it("defines Step 6 frozen reveal rules and relational paid authorization", async () => {
    const [schema, migration] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(step6MigrationPath, "utf8"),
    ]);

    expect(schema).toMatch(/paidCardRevealEnabled\s+Boolean\s+@default\(false\)/);
    expect(schema).toMatch(/paidCardRevealCost\s+Int\s+@default\(0\)/);
    expect(schema).toContain("model PaidCardReveal {");
    expect(schema).toContain("@@unique([buyerUserId, handId, targetUserId])");
    expect(schema).toContain("@@unique([walletLedgerEntryId, buyerUserId, roomId, handId, walletSignedAmount, walletType])");
    const handPlayerModel = /model HandPlayerRecord \{(?<body>[\s\S]*?)\n\}/u.exec(schema)?.groups?.body;
    const walletLedgerModel = /model WalletLedgerEntry \{(?<body>[\s\S]*?)\n\}/u.exec(schema)?.groups?.body;
    const gameSessionModel = /model GameSession \{(?<body>[\s\S]*?)\n\}/u.exec(schema)?.groups?.body;
    const handRecordModel = /model HandRecord \{(?<body>[\s\S]*?)\n\}/u.exec(schema)?.groups?.body;
    const tableStackModel = /model TableStackLedgerEntry \{(?<body>[\s\S]*?)\n\}/u.exec(schema)?.groups?.body;
    expect(gameSessionModel).toContain("@@index([userId, startedAt, id])");
    expect(handRecordModel).toContain("@@index([roomId, finishedAt, id])");
    expect(handPlayerModel).toContain("@@index([userId, createdAt, handId])");
    expect(tableStackModel).toContain("@@index([userId, createdAt, handId])");
    expect(walletLedgerModel).toContain("@@index([userId, sequence])");
    for (const index of [
      "GameSession_userId_startedAt_id_idx",
      "HandRecord_roomId_finishedAt_id_idx",
      "HandPlayerRecord_userId_createdAt_handId_idx",
      "TableStackLedgerEntry_userId_createdAt_handId_idx",
      "WalletLedgerEntry_userId_sequence_idx",
    ]) expect(migration).toContain(`CREATE INDEX "${index}"`);
    for (const oldIndex of [
      "GameSession_userId_startedAt_idx",
      "HandRecord_roomId_finishedAt_idx",
      "HandPlayerRecord_userId_createdAt_idx",
      "TableStackLedgerEntry_userId_createdAt_idx",
    ]) expect(migration).toContain(`DROP INDEX "${oldIndex}"`);
    for (const constraint of [
      "HandRecord_paid_reveal_check",
      "PaidCardReveal_participants_check",
      "PaidCardReveal_cost_check",
      "PaidCardReveal_wallet_pair_check",
      "PaidCardReveal_buyer_participant_fkey",
      "PaidCardReveal_target_participant_fkey",
      "PaidCardReveal_wallet_transfer_pair_fkey",
    ]) expect(migration).toContain(constraint);
    expect(migration).toContain("ALTER TYPE \"IdempotencyScope\" ADD VALUE 'PAID_CARD_REVEAL'");
  });

  it("defines the Step 5 snapshot, receipt, and hand-number authority", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain("enum TableRuntimeStatus {");
    expect(schema).toContain("RECOVERY_ERROR");
    expect(schema).toContain("enum SnapshotRecoveryStatus {");
    expect(schema).toContain("model TableSnapshot {");
    expect(schema).toContain("model TableActionReceipt {");
    expect(schema).toMatch(/nextHandNumber\s+Int\s+@default\(1\)/);
    expect(schema).toContain("@@unique([roomId, userId, clientActionId])");
    expect(schema).toContain("@@index([activeHandId])");
    expect(schema).toContain("@@index([runtimeStatus])");
  });

  it("defines fixed room clocks, point fees, pending-show state, and per-user runout purchases", async () => {
    const [schema, migration, compatibility] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(roomClockMigrationPath, "utf8"),
      readFile(roomClockCompatibilityMigrationPath, "utf8"),
    ]);

    expect(schema).toContain("model HypotheticalRunoutPurchase {");
    expect(schema).toMatch(/durationMinutes\s+Int\s+@default\(60\)/);
    expect(schema).toMatch(/expiresAt\s+DateTime/);
    expect(schema).toMatch(/pendingShowCardIndices\s+Int\[\]/);
    for (const value of ["HYPOTHETICAL_RUNOUT", "ACTION_TIME_EXTENSION", "TABLE_ACTION_TIME_EXTENSION"]) {
      expect(schema).toContain(value);
      expect(migration).toContain(value);
    }
    expect(schema).toContain("HAND_ENTRY_FEE");
    for (const constraint of [
      "Room_actionTimeSeconds_range_step_check",
      "Room_durationMinutes_range_step_check",
      "TableSeat_pendingShowCardIndices_check",
      "HypotheticalRunoutPurchase_wallet_check",
      "HypotheticalRunoutPurchase_wallet_fkey",
    ]) expect(migration).toContain(constraint);
    expect(compatibility).toContain('WHERE "status" = \'OPEN\'');
    expect(compatibility).toContain('"expiresAt" <= CURRENT_TIMESTAMP');
  });

  it("installs database final defenses for the Step 5 durable models", async () => {
    const migration = await readFile(step5MigrationPath, "utf8");

    for (const constraint of [
      "TableSnapshot_schemaVersion_check",
      "TableSnapshot_stateVersion_check",
      "TableSnapshot_snapshotRevision_check",
      "TableSnapshot_active_hand_pair_check",
      "TableSnapshot_turn_deadline_hand_check",
      "TableActionReceipt_resultingStateVersion_check",
    ]) expect(migration).toContain(constraint);
    expect(migration).toContain('CREATE UNIQUE INDEX "TableSnapshot_roomId_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "TableActionReceipt_roomId_userId_clientActionId_key"');
    expect(migration).toMatch(/MAX\("handNumber"\) \+ 1 AS "nextHandNumber"/);
    expect(migration).toContain('WHERE history."roomId" = room."id"');
    expect(migration).toContain('REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE RESTRICT');
    expect(migration).toContain('REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT');
  });

  it("declares audit and privacy uniqueness constraints", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toMatch(/usernameNormalized\s+String\s+@unique/);
    expect(schema).toMatch(/tokenHash\s+String\s+@unique/);
    expect(schema).toMatch(/userId\s+String\s+@unique/);
    expect(schema).toMatch(/roomCode\s+String\s+@unique/);
    expect(schema).toContain("@@unique([walletId, sequence])");
    expect(schema).toMatch(/idempotencyKey\s+String\s+@unique/);
    expect(schema).toContain("@@unique([roomId, userId])");
    expect(schema).toContain("@@unique([scope, actorId, key])");
    expect(schema).toContain("@@unique([roomId, seatIndex])");
    expect(schema).toContain("@@unique([gameSessionId, sequence])");
    expect(schema).toContain("@@unique([roomId, handNumber])");
    expect(schema).toContain("@@unique([handId, userId])");
    expect(schema).toContain("@@unique([handId, seatIndex])");
    expect(schema).toContain("@@unique([handId, sequence])");
    expect(schema).toContain("@@unique([handId, potIndex])");
    expect(schema).toMatch(/walletLedgerEntryId\s+String\?\s+@unique/);
  });

  it("declares the table lifecycle and audit enums", async () => {
    const schema = await readFile(schemaPath, "utf8");

    for (const enumName of [
      "TableSeatPlayStatus",
      "GameSessionStatus",
      "TableStackLedgerType",
      "HandFinishReason",
      "HandStreet",
      "HandActionType",
    ]) {
      expect(schema).toContain(`enum ${enumName} {`);
    }
    for (const value of [
      "SIT_OUT_AFTER_HAND",
      "LEAVE_AFTER_HAND",
      "HAND_RESULT",
      "FOLD_TO_WIN",
      "SHOWDOWN",
      "RAISE_TO",
      "TABLE_SEAT_TAKE",
      "TABLE_BUY_IN",
      "TABLE_LEAVE",
    ]) {
      expect(schema).toContain(value);
    }
  });

  it("uses Restrict for every audit-bearing foreign key", async () => {
    const schema = await readFile(schemaPath, "utf8");
    const relationDeclarations = schema
      .split("\n")
      .filter(
        (line) => line.includes("@relation(") && line.includes("fields:"),
      );

    expect(relationDeclarations.length).toBeGreaterThanOrEqual(28);
    expect(relationDeclarations.every((line) => line.includes("onDelete: Restrict"))).toBe(true);
  });

  it("normalizes unsafe Step 3 room limits before installing the Step 4 aggregate check", async () => {
    const migration = await readFile(legacyRoomNormalizationPath, "utf8");

    expect(migration).toContain('WHERE "maximumBuyIn" * "maxSeats"::BIGINT > 2000000000');
    expect(migration).toContain('"maximumBuyIn" = unsafe."safeMaximum"');
    expect(migration).toContain('WHEN room."status" = \'OPEN\' THEN TRUE');
  });

  it("defines Step 6.5 mobile lifecycle, account, review and hand-level history authority", async () => {
    const [schema, migration] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(step65MigrationPath, "utf8"),
    ]);

    for (const model of ["PaidHandRevealPurchase", "HandHypotheticalRunout"]) {
      expect(schema).toContain(`model ${model} {`);
    }
    for (const enumName of [
      "HandActionAutomaticReason",
      "HoleCardsPublicReason",
      "HypotheticalRunoutGenerationSource",
    ]) expect(schema).toContain(`enum ${enumName} {`);
    for (const field of [
      "phoneNumber",
      "tableStartedAt",
      "requiresManualStart",
      "archivedAt",
      "archivedByUserId",
      "nextActionAutopilotArmed",
      "reservedAwayEndsAt",
      "automaticReason",
      "holeCardsPublicReason",
      "voluntarilyRevealedAt",
      "reviewEndsAt",
      "remainingDeck",
    ]) expect(schema).toContain(field);
    for (const value of [
      "POST_HAND_REVIEW",
      "RESERVED_AWAY",
      "BUSTED_WAITING_REBUY",
      "NEXT_DECISION_AUTOPILOT",
      "TURN_TIMEOUT",
      "VOLUNTARY",
      "ORIGINAL_REMAINING_DECK",
      "CSPRNG_LEGACY_FALLBACK",
      "TABLE_START",
      "PHONE_BIND",
      "ROOM_ARCHIVE",
    ]) expect(schema).toContain(value);
    expect(schema).toContain("@@unique([buyerUserId, handId])");
    expect(schema).toMatch(/handId\s+String\s+@unique/);

    for (const constraint of [
      "User_phone_number_format_check",
      "Room_archive_pair_check",
      "TableSeat_reserved_away_pair_check",
      "HandPlayerRecord_public_reason_check",
      "PaidHandRevealPurchase_cost_check",
      "HandHypotheticalRunout_cards_check",
    ]) expect(migration).toContain(constraint);
    expect(migration).toContain("UPDATE \"HandPlayerRecord\"");
    expect(migration).toContain("'SHOWDOWN'");
    expect(migration).not.toMatch(/DROP TABLE\s+"(?:Room|HandRecord|PaidCardReveal)"/u);
  });

  it("persists one immutable five-card board for every new hand", async () => {
    const [schema, migration] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(uiIssueFixesMigrationPath, "utf8"),
    ]);
    expect(schema).toMatch(/fullBoard\s+String\[\]\s+@default\(\[\]\)/u);
    expect(migration).toContain('ADD COLUMN "fullBoard" TEXT[]');
    expect(migration).toContain('"HandRecord_fullBoard_length_check"');
    expect(migration).toContain('"board" || "remainingDeck"[1:(5 - cardinality("board"))]');
    expect(migration).not.toMatch(/DROP TABLE/u);
  });

  it("persists voluntary reveal authority for each individual hole-card slot", async () => {
    const [schema, migration] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(perCardRevealMigrationPath, "utf8"),
    ]);
    expect(schema).toMatch(/voluntarilyRevealedCardIndices\s+Int\[\]\s+@default\(\[\]\)/u);
    expect(migration).toContain('ADD COLUMN "voluntarilyRevealedCardIndices" INTEGER[]');
    expect(migration).toContain("cardinality(\"voluntarilyRevealedCardIndices\") BETWEEN 1 AND 2");
    expect(migration).toContain('"holeCardsPublic" = (cardinality("voluntarilyRevealedCardIndices") = 2)');
  });

  it("persists current-bet-bound auto-call authority with a database guard", async () => {
    const [schema, migration] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(autoCallMigrationPath, "utf8"),
    ]);
    expect(schema).toMatch(/nextActionAutoCallCurrentBet\s+Int\?/u);
    expect(schema).toContain("NEXT_DECISION_AUTO_CALL");
    expect(migration).toContain('ADD COLUMN "nextActionAutoCallCurrentBet" INTEGER');
    expect(migration).toContain('"TableSeat_next_action_auto_call_guard"');
    expect(migration).toContain("'NEXT_DECISION_AUTO_CALL'");
  });

  it("defines the append-only Step 7 administrator audit authority", async () => {
    const [schema, migration] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(step7AdminAuditMigrationPath, "utf8"),
    ]);

    expect(schema).toContain("ADMIN_WALLET_ADJUSTMENT");
    expect(schema).toContain("model AuditLog {");
    for (const field of [
      "actorUserId",
      "actorRole",
      "action",
      "targetType",
      "targetId",
      "targetUserId",
      "roomId",
      "handId",
      "requestId",
      "operationId",
      "reason",
      "ipAddressSummary",
      "userAgentSummary",
      "metadata",
      "createdAt",
    ]) expect(schema).toContain(field);
    expect(schema).toContain("@@unique([actorUserId, operationId])");
    expect(schema).toContain("@@index([action, createdAt, id])");
    expect(schema).toContain("@@index([targetType, targetId, createdAt, id])");
    for (const constraint of [
      "AuditLog_action_check",
      "AuditLog_target_type_check",
      "AuditLog_reason_check",
      "AuditLog_request_id_check",
      "AuditLog_operation_id_check",
    ]) expect(migration).toContain(constraint);
    expect(migration).toContain("ALTER TYPE \"IdempotencyScope\" ADD VALUE 'ADMIN_WALLET_ADJUSTMENT'");
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN/u);
  });

  it("removes only the obsolete sparse action-time constraint in Step 8", async () => {
    const migration = await readFile(step8ActionTimeConstraintFixPath, "utf8");
    expect(migration).toContain('DROP CONSTRAINT "Room_action_time_check"');
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE/u);
  });

  it("allows room-scoped point ledgers and indexes 30-day retention scans", async () => {
    const migration = await readFile(roomPointsRetentionMigrationPath, "utf8");
    expect(migration).toContain('"TableStackLedgerEntry_room_points_shape_check"');
    expect(migration).toContain('"walletLedgerEntryId" IS NULL');
    expect(migration).toContain('"walletType" IS NULL');
    for (const index of [
      "UserSession_expiresAt_idx",
      "UserSession_revokedAt_idx",
      "RequestIdempotency_createdAt_idx",
      "AuditLog_createdAt_idx",
      "WalletLedgerEntry_createdAt_idx",
    ]) expect(migration).toContain(index);
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE/u);
  });

  it("moves diagnostics out of PostgreSQL and reserves nine fixed test-bot slots", async () => {
    const [schema, oldMigration, migration] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(diagnosticTraceMigrationPath, "utf8"),
      readFile(localAdministratorLogsMigrationPath, "utf8"),
    ]);

    expect(oldMigration).toContain("capture_table_snapshot_diagnostic_trace");
    expect(schema).not.toContain("model ServerFeatureFlag {");
    expect(schema).not.toContain("model TableDiagnosticTrace {");
    expect(schema).toContain("isTestBot");
    expect(schema).toContain("testBotOrdinal");
    expect(migration).toContain('DROP TABLE IF EXISTS "TableDiagnosticTrace"');
    expect(migration).toContain('DROP TABLE IF EXISTS "ServerFeatureFlag"');
    expect(migration).toContain('"testBotOrdinal" BETWEEN 1 AND 9');
  });

  it("preserves one room-scoped stack across stand and re-seat", async () => {
    const [schema, migration] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(roomStackContinuityMigrationPath, "utf8"),
    ]);

    expect(schema).toMatch(/initialBuyIn\s+Int\s+@default\(2000\)/u);
    expect(schema).toMatch(/detachedStack\s+Int\?/u);
    expect(migration).toContain('CREATE UNIQUE INDEX "GameSession_roomId_userId_active_key"');
    expect(migration).toContain('WHERE "status" = \'ACTIVE\'');
    expect(migration).toContain('"GameSession_detachedStack_check"');
    expect(migration).toContain('"TableSeat_gameSessionId_roomId_userId_fkey"');
    expect(migration).toContain('"HandPlayerRecord_gameSessionId_roomId_userId_fkey"');
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE/u);
  });

  it("persists squid-round authority and cross-hand trusteeship with guarded ledgers", async () => {
    const [schema, modeMigration, ledgerMigration] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(squidModeMigrationPath, "utf8"),
      readFile(squidLedgerGuardMigrationPath, "utf8"),
    ]);
    expect(schema).toContain("enum RoomSpecialMode");
    expect(schema).toContain("SQUID_SETTLEMENT");
    expect(schema).toContain("TRUSTEESHIP");
    for (const field of [
      "specialMode",
      "squidStake",
      "squidRoundNumber",
      "squidRoundGraceEndsAt",
      "squidSettlementPending",
      "squidMarked",
      "squidRoundParticipant",
      "trusteeshipEnabled",
    ]) expect(schema).toContain(field);
    expect(modeMigration).toContain('"Room_squid_mode_shape_check"');
    expect(modeMigration).toContain('"Room_squid_round_state_check"');
    expect(modeMigration).toContain('"TableSeat_squid_state_check"');
    expect(modeMigration).toContain("TABLE_TRUSTEESHIP_SET");
    expect(ledgerMigration).toContain('"TableStackLedgerEntry_room_points_shape_check"');
    expect(ledgerMigration).toContain("'SQUID_SETTLEMENT'");
    expect(`${modeMigration}\n${ledgerMigration}`).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE/u);
  });

  it("persists normal-mode run-it-twice votes, boards, and per-board pots", async () => {
    const [schema, migration] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(runItTwiceMigrationPath, "utf8"),
    ]);
    expect(schema).toMatch(/runItTwiceEnabled\s+Boolean\s+@default\(false\)/u);
    expect(schema).toMatch(/runoutCount\s+Int\s+@default\(1\)/u);
    expect(schema).toContain("TABLE_RUNOUT_CHOICE");
    expect(schema).toContain("model HandRunoutRecord {");
    expect(schema).toContain("model HandRunoutPotRecord {");
    expect(schema).toContain("@@unique([handId, runoutIndex])");
    expect(schema).toContain("@@unique([handId, runoutIndex, potIndex])");
    for (const constraint of [
      "Room_run_it_twice_mode_check",
      "HandRecord_runout_count_check",
      "HandRecord_runout_votes_shape_check",
      "HandRunoutRecord_shape_check",
      "HandRunoutPotRecord_shape_check",
    ]) expect(migration).toContain(constraint);
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE/u);
  });

  it("stores one constrained avatar-library identifier on every user", async () => {
    const [schema, migration] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(avatarLibraryMigrationPath, "utf8"),
    ]);
    expect(schema).toMatch(/avatarId\s+String\s+@default\("avatar-01"\)\s+@db\.VarChar\(16\)/u);
    expect(migration).toContain('"User_avatarId_check"');
    expect(migration).toContain("'avatar-16'");
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE/u);
  });

  it("persists the mutually exclusive bomb-pot schedule and per-hand forced blind", async () => {
    const [schema, enumMigration, rulesMigration] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(bombPotEnumMigrationPath, "utf8"),
      readFile(bombPotRulesMigrationPath, "utf8"),
    ]);
    expect(schema).toContain("BOMB_POT");
    for (const field of ["bombPotBlindMultiplier", "bombPotIntervalMinutes", "bombPotNextAt", "bombPotBlindAmount"]) {
      expect(schema).toContain(field);
    }
    expect(enumMigration).toContain("ADD VALUE 'BOMB_POT'");
    expect(rulesMigration).toContain('"Room_squid_mode_shape_check"');
    expect(rulesMigration).toContain('MOD("bombPotIntervalMinutes", 5) = 0');
    expect(rulesMigration).toContain('"HandRecord_bombPotBlindAmount_check"');
    expect(`${enumMigration}\n${rulesMigration}`).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE/u);
  });
});
