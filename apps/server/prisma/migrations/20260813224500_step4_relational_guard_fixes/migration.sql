-- Follow-up fixes for the Step 4 relational guards. Keep the previously
-- applied migration immutable and tighten its nullable CHECK semantics here.

ALTER TABLE "TableStackLedgerEntry"
  DROP CONSTRAINT "TableStackLedgerEntry_wallet_pair_shape_check",
  ADD CONSTRAINT "TableStackLedgerEntry_wallet_pair_shape_check"
  CHECK (
    (
      "type" = 'HAND_RESULT'
      AND "walletLedgerEntryId" IS NULL
      AND "walletSignedAmount" IS NULL
      AND "walletType" IS NULL
    )
    OR
    (
      "type" = 'BUY_IN'
      AND "walletLedgerEntryId" IS NOT NULL
      AND "walletSignedAmount" IS NOT NULL
      AND "walletType" IS NOT NULL
      AND "walletType" = 'BUY_IN'
      AND "walletSignedAmount" = -"signedAmount"
    )
    OR
    (
      "type" = 'CASH_OUT'
      AND "walletLedgerEntryId" IS NOT NULL
      AND "walletSignedAmount" IS NOT NULL
      AND "walletType" IS NOT NULL
      AND "walletType" = 'CASH_OUT'
      AND "walletSignedAmount" = -"signedAmount"
    )
  );

DROP INDEX "HandActionRecord_handId_clientActionId_key";

CREATE UNIQUE INDEX "HandActionRecord_handId_userId_clientActionId_key"
  ON "HandActionRecord"("handId", "userId", "clientActionId");
