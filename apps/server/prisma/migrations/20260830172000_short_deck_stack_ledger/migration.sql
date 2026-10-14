ALTER TABLE "TableStackLedgerEntry"
  DROP CONSTRAINT "TableStackLedgerEntry_room_points_shape_check";

ALTER TABLE "TableStackLedgerEntry"
  ADD CONSTRAINT "TableStackLedgerEntry_room_points_shape_check"
  CHECK (
    (
      "type" = 'BUY_IN'
      AND "signedAmount" > 0
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
      AND (("handId" IS NULL AND "stackAfter" = 0) OR "handId" IS NOT NULL)
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
    OR
    (
      "type" = 'SQUID_SETTLEMENT'
      AND "signedAmount" <> 0
      AND "walletLedgerEntryId" IS NULL
      AND "walletSignedAmount" IS NULL
      AND "walletType" IS NULL
      AND "handId" IS NULL
    )
  );
