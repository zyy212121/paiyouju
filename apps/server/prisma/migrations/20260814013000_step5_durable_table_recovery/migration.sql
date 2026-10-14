-- Step 5 durable table snapshots, action receipts, and per-room hand allocation.
CREATE TYPE "TableRuntimeStatus" AS ENUM (
  'IDLE', 'START_COUNTDOWN', 'PLAYING', 'PAUSED', 'CLOSING',
  'PERSISTENCE_ERROR', 'RECOVERY_ERROR', 'CLOSED'
);

CREATE TYPE "SnapshotRecoveryStatus" AS ENUM ('PENDING', 'READY', 'ERROR');

ALTER TABLE "Room"
  ADD COLUMN "nextHandNumber" INTEGER NOT NULL DEFAULT 1;

-- Existing Step 4 rooms can already own completed hands. Backfill the
-- allocator before accepting a new hand so upgrades never reuse a durable
-- (roomId, handNumber) pair.
UPDATE "Room" AS room
SET "nextHandNumber" = history."nextHandNumber"
FROM (
  SELECT "roomId", MAX("handNumber") + 1 AS "nextHandNumber"
  FROM "HandRecord"
  GROUP BY "roomId"
) AS history
WHERE history."roomId" = room."id";

ALTER TABLE "Room"
  ADD CONSTRAINT "Room_nextHandNumber_check"
  CHECK ("nextHandNumber" > 0);

CREATE TABLE "TableSnapshot" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "stateVersion" INTEGER NOT NULL DEFAULT 0,
  "snapshotRevision" INTEGER NOT NULL DEFAULT 0,
  "runtimeStatus" "TableRuntimeStatus" NOT NULL DEFAULT 'IDLE',
  "activeHandId" TEXT,
  "activeHandNumber" INTEGER,
  "turnDeadlineAt" TIMESTAMP(3),
  "startDeadlineAt" TIMESTAMP(3),
  "payload" JSONB NOT NULL,
  "recoveryStatus" "SnapshotRecoveryStatus" NOT NULL DEFAULT 'READY',
  "lastRecoveryError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TableSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TableSnapshot_schemaVersion_check" CHECK ("schemaVersion" > 0),
  CONSTRAINT "TableSnapshot_stateVersion_check" CHECK ("stateVersion" >= 0),
  CONSTRAINT "TableSnapshot_snapshotRevision_check" CHECK ("snapshotRevision" >= 0),
  CONSTRAINT "TableSnapshot_active_hand_pair_check" CHECK (("activeHandId" IS NULL) = ("activeHandNumber" IS NULL)),
  CONSTRAINT "TableSnapshot_turn_deadline_hand_check" CHECK ("turnDeadlineAt" IS NULL OR "activeHandId" IS NOT NULL),
  CONSTRAINT "TableSnapshot_active_hand_number_check" CHECK ("activeHandNumber" IS NULL OR "activeHandNumber" > 0),
  CONSTRAINT "TableSnapshot_recovery_error_check" CHECK (("recoveryStatus" = 'ERROR') = ("lastRecoveryError" IS NOT NULL))
);

CREATE UNIQUE INDEX "TableSnapshot_roomId_key" ON "TableSnapshot"("roomId");
CREATE INDEX "TableSnapshot_activeHandId_idx" ON "TableSnapshot"("activeHandId");
CREATE INDEX "TableSnapshot_runtimeStatus_idx" ON "TableSnapshot"("runtimeStatus");
CREATE INDEX "TableSnapshot_recoveryStatus_idx" ON "TableSnapshot"("recoveryStatus");

ALTER TABLE "TableSnapshot"
  ADD CONSTRAINT "TableSnapshot_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "TableActionReceipt" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "handId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientActionId" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "actionType" "HandActionType" NOT NULL,
  "resultingStateVersion" INTEGER NOT NULL,
  "resultCode" TEXT NOT NULL,
  "resultPayload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TableActionReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TableActionReceipt_resultingStateVersion_check" CHECK ("resultingStateVersion" >= 0),
  CONSTRAINT "TableActionReceipt_fingerprint_check" CHECK (length("requestFingerprint") = 64),
  CONSTRAINT "TableActionReceipt_result_code_check" CHECK (length("resultCode") > 0)
);

CREATE UNIQUE INDEX "TableActionReceipt_roomId_userId_clientActionId_key"
  ON "TableActionReceipt"("roomId", "userId", "clientActionId");
CREATE INDEX "TableActionReceipt_handId_idx" ON "TableActionReceipt"("handId");
CREATE INDEX "TableActionReceipt_roomId_createdAt_idx" ON "TableActionReceipt"("roomId", "createdAt");

ALTER TABLE "TableActionReceipt"
  ADD CONSTRAINT "TableActionReceipt_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "TableActionReceipt"
  ADD CONSTRAINT "TableActionReceipt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
