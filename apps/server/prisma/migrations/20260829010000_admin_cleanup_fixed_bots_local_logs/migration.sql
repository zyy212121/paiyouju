ALTER TABLE "User"
ADD COLUMN "isTestBot" BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN "testBotOrdinal" INTEGER,
ADD COLUMN "testBotLeaseId" UUID,
ADD COLUMN "testBotLeaseExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_testBotOrdinal_key" ON "User"("testBotOrdinal");

ALTER TABLE "User"
ADD CONSTRAINT "User_test_bot_shape_check" CHECK (
  ("isTestBot" = TRUE AND "role" = 'USER' AND "testBotOrdinal" BETWEEN 1 AND 9)
  OR
  ("isTestBot" = FALSE AND "testBotOrdinal" IS NULL AND "testBotLeaseId" IS NULL AND "testBotLeaseExpiresAt" IS NULL)
),
ADD CONSTRAINT "User_test_bot_lease_check" CHECK (
  ("testBotLeaseId" IS NULL) = ("testBotLeaseExpiresAt" IS NULL)
);

DROP TRIGGER IF EXISTS "TableSnapshot_diagnostic_trace_trigger" ON "TableSnapshot";
DROP FUNCTION IF EXISTS capture_table_snapshot_diagnostic_trace();
DROP TRIGGER IF EXISTS "TableDiagnosticTrace_append_only_trigger" ON "TableDiagnosticTrace";
DROP FUNCTION IF EXISTS reject_table_diagnostic_trace_update();
DROP TABLE IF EXISTS "TableDiagnosticTrace";
DROP TYPE IF EXISTS "TableDiagnosticTraceKind";
DROP TABLE IF EXISTS "ServerFeatureFlag";
