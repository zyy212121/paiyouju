-- New table points are room-scoped counters. Historical paired transfers remain
-- valid, but new BUY_IN/CASH_OUT rows may not reference a Wallet ledger entry.
ALTER TABLE "TableStackLedgerEntry"
  DROP CONSTRAINT IF EXISTS "TableStackLedgerEntry_type_link_check",
  DROP CONSTRAINT IF EXISTS "TableStackLedgerEntry_wallet_pair_shape_check";

ALTER TABLE "TableStackLedgerEntry"
  ADD CONSTRAINT "TableStackLedgerEntry_room_points_shape_check"
  CHECK (
    (
      "type" = 'BUY_IN'
      AND "signedAmount" > 0
      AND "handId" IS NULL
      AND (
        (
          "walletLedgerEntryId" IS NULL
          AND "walletSignedAmount" IS NULL
          AND "walletType" IS NULL
        )
        OR
        (
          "walletLedgerEntryId" IS NOT NULL
          AND "walletSignedAmount" = -"signedAmount"
          AND "walletType" = 'BUY_IN'
        )
      )
    )
    OR
    (
      "type" = 'CASH_OUT'
      AND "signedAmount" < 0
      AND "stackAfter" = 0
      AND "handId" IS NULL
      AND (
        (
          "walletLedgerEntryId" IS NULL
          AND "walletSignedAmount" IS NULL
          AND "walletType" IS NULL
        )
        OR
        (
          "walletLedgerEntryId" IS NOT NULL
          AND "walletSignedAmount" = -"signedAmount"
          AND "walletType" = 'CASH_OUT'
        )
      )
    )
    OR
    (
      "type" = 'HAND_RESULT'
      AND "walletLedgerEntryId" IS NULL
      AND "walletSignedAmount" IS NULL
      AND "walletType" IS NULL
      AND "handId" IS NOT NULL
    )
  );

CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");
CREATE INDEX "UserSession_revokedAt_idx" ON "UserSession"("revokedAt");
CREATE INDEX "RequestIdempotency_createdAt_idx" ON "RequestIdempotency"("createdAt");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "WalletLedgerEntry_createdAt_idx" ON "WalletLedgerEntry"("createdAt");
