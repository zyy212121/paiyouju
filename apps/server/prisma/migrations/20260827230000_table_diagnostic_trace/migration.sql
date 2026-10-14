CREATE TYPE "TableDiagnosticTraceKind" AS ENUM ('SNAPSHOT', 'COMMAND');

CREATE TABLE "ServerFeatureFlag" (
    "key" VARCHAR(80) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServerFeatureFlag_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "TableDiagnosticTrace" (
    "id" BIGSERIAL NOT NULL,
    "roomId" TEXT NOT NULL,
    "handId" VARCHAR(160),
    "actorUserId" VARCHAR(64),
    "kind" "TableDiagnosticTraceKind" NOT NULL,
    "eventName" VARCHAR(80),
    "stateVersion" INTEGER,
    "snapshotRevision" INTEGER,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TableDiagnosticTrace_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TableDiagnosticTrace_state_version_check" CHECK ("stateVersion" IS NULL OR "stateVersion" >= 0),
    CONSTRAINT "TableDiagnosticTrace_snapshot_revision_check" CHECK ("snapshotRevision" IS NULL OR "snapshotRevision" >= 0),
    CONSTRAINT "TableDiagnosticTrace_payload_object_check" CHECK (jsonb_typeof("payload") = 'object'),
    CONSTRAINT "TableDiagnosticTrace_kind_shape_check" CHECK (
      ("kind" = 'SNAPSHOT' AND "snapshotRevision" IS NOT NULL)
      OR ("kind" = 'COMMAND' AND "eventName" IS NOT NULL AND "actorUserId" IS NOT NULL)
    )
);

CREATE INDEX "TableDiagnosticTrace_roomId_createdAt_id_idx"
ON "TableDiagnosticTrace"("roomId", "createdAt", "id");

CREATE INDEX "TableDiagnosticTrace_handId_createdAt_id_idx"
ON "TableDiagnosticTrace"("handId", "createdAt", "id");

CREATE INDEX "TableDiagnosticTrace_createdAt_id_idx"
ON "TableDiagnosticTrace"("createdAt", "id");

ALTER TABLE "TableDiagnosticTrace"
ADD CONSTRAINT "TableDiagnosticTrace_roomId_fkey"
FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

INSERT INTO "ServerFeatureFlag" ("key", "enabled", "createdAt", "updatedAt")
VALUES ('TABLE_DIAGNOSTIC_TRACE', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

CREATE FUNCTION capture_table_snapshot_diagnostic_trace()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ServerFeatureFlag"
    WHERE "key" = 'TABLE_DIAGNOSTIC_TRACE' AND "enabled" = TRUE
  ) THEN
    INSERT INTO "TableDiagnosticTrace" (
      "roomId",
      "handId",
      "kind",
      "eventName",
      "stateVersion",
      "snapshotRevision",
      "payload",
      "createdAt"
    ) VALUES (
      NEW."roomId",
      NEW."activeHandId",
      'SNAPSHOT',
      TG_OP,
      NEW."stateVersion",
      NEW."snapshotRevision",
      to_jsonb(NEW),
      CURRENT_TIMESTAMP
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "TableSnapshot_diagnostic_trace_trigger"
AFTER INSERT OR UPDATE ON "TableSnapshot"
FOR EACH ROW
EXECUTE FUNCTION capture_table_snapshot_diagnostic_trace();

CREATE FUNCTION reject_table_diagnostic_trace_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'TableDiagnosticTrace rows are append-only';
END;
$$;

CREATE TRIGGER "TableDiagnosticTrace_append_only_trigger"
BEFORE UPDATE ON "TableDiagnosticTrace"
FOR EACH ROW
EXECUTE FUNCTION reject_table_diagnostic_trace_update();
