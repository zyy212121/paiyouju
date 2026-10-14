ALTER TYPE "IdempotencyScope" ADD VALUE 'ADMIN_WALLET_ADJUSTMENT';

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorRole" "UserRole" NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "targetType" VARCHAR(64) NOT NULL,
    "targetId" VARCHAR(128),
    "targetUserId" TEXT,
    "roomId" TEXT,
    "handId" TEXT,
    "requestId" UUID NOT NULL,
    "operationId" UUID,
    "reason" VARCHAR(200),
    "ipAddressSummary" VARCHAR(128),
    "userAgentSummary" VARCHAR(256),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditLog_action_check" CHECK ("action" = btrim("action") AND char_length("action") BETWEEN 1 AND 80 AND "action" ~ '^[A-Z0-9_]+$'),
    CONSTRAINT "AuditLog_target_type_check" CHECK ("targetType" = btrim("targetType") AND char_length("targetType") BETWEEN 1 AND 64 AND "targetType" ~ '^[A-Z0-9_]+$'),
    CONSTRAINT "AuditLog_reason_check" CHECK ("reason" IS NULL OR ("reason" = btrim("reason") AND char_length("reason") BETWEEN 8 AND 200 AND "reason" !~ '[[:cntrl:]<>]')),
    CONSTRAINT "AuditLog_request_id_check" CHECK ("requestId"::TEXT ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    CONSTRAINT "AuditLog_operation_id_check" CHECK ("operationId" IS NULL OR "operationId"::TEXT ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
);

CREATE UNIQUE INDEX "AuditLog_actorUserId_operationId_key" ON "AuditLog"("actorUserId", "operationId");
CREATE INDEX "AuditLog_actorUserId_createdAt_id_idx" ON "AuditLog"("actorUserId", "createdAt", "id");
CREATE INDEX "AuditLog_action_createdAt_id_idx" ON "AuditLog"("action", "createdAt", "id");
CREATE INDEX "AuditLog_targetType_targetId_createdAt_id_idx" ON "AuditLog"("targetType", "targetId", "createdAt", "id");
CREATE INDEX "AuditLog_targetUserId_createdAt_id_idx" ON "AuditLog"("targetUserId", "createdAt", "id");
CREATE INDEX "AuditLog_roomId_createdAt_id_idx" ON "AuditLog"("roomId", "createdAt", "id");
CREATE INDEX "AuditLog_handId_createdAt_id_idx" ON "AuditLog"("handId", "createdAt", "id");

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_handId_fkey" FOREIGN KEY ("handId") REFERENCES "HandRecord"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
