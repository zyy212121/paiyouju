-- Strengthen the database's final defence: every current seat and historical
-- player row must refer to the same user/room/seat as its GameSession, and a
-- Wallet/Table transfer pair must agree on identity, resource and inverse
-- amount. Application transactions still create both entries atomically.

CREATE UNIQUE INDEX "GameSession_id_roomId_userId_seatIndex_key"
  ON "GameSession"("id", "roomId", "userId", "seatIndex");

CREATE UNIQUE INDEX "GameSession_id_userId_seatIndex_key"
  ON "GameSession"("id", "userId", "seatIndex");

CREATE UNIQUE INDEX "TableSeat_gameSessionId_roomId_userId_seatIndex_key"
  ON "TableSeat"("gameSessionId", "roomId", "userId", "seatIndex");

ALTER TABLE "TableSeat"
  DROP CONSTRAINT "TableSeat_gameSessionId_fkey",
  ADD CONSTRAINT "TableSeat_gameSessionId_roomId_userId_seatIndex_fkey"
    FOREIGN KEY ("gameSessionId", "roomId", "userId", "seatIndex")
    REFERENCES "GameSession"("id", "roomId", "userId", "seatIndex")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "HandPlayerRecord"
  ADD COLUMN "roomId" TEXT;

UPDATE "HandPlayerRecord" player
SET "roomId" = hand."roomId"
FROM "HandRecord" hand
WHERE player."handId" = hand."id";

ALTER TABLE "HandPlayerRecord"
  ALTER COLUMN "roomId" SET NOT NULL;

CREATE UNIQUE INDEX "HandRecord_id_roomId_key"
  ON "HandRecord"("id", "roomId");

ALTER TABLE "HandPlayerRecord"
  DROP CONSTRAINT "HandPlayerRecord_handId_fkey",
  DROP CONSTRAINT "HandPlayerRecord_gameSessionId_fkey",
  ADD CONSTRAINT "HandPlayerRecord_handId_roomId_fkey"
    FOREIGN KEY ("handId", "roomId")
    REFERENCES "HandRecord"("id", "roomId")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "HandPlayerRecord_gameSessionId_roomId_userId_seatIndex_fkey"
    FOREIGN KEY ("gameSessionId", "roomId", "userId", "seatIndex")
    REFERENCES "GameSession"("id", "roomId", "userId", "seatIndex")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "TableStackLedgerEntry"
  ADD COLUMN "walletSignedAmount" INTEGER,
  ADD COLUMN "walletType" "WalletLedgerType";

UPDATE "TableStackLedgerEntry" table_entry
SET
  "walletSignedAmount" = wallet_entry."signedAmount",
  "walletType" = wallet_entry."type"
FROM "WalletLedgerEntry" wallet_entry
WHERE table_entry."walletLedgerEntryId" = wallet_entry."id";

ALTER TABLE "TableStackLedgerEntry"
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
      AND "walletType" = 'BUY_IN'
      AND "walletSignedAmount" = -"signedAmount"
    )
    OR
    (
      "type" = 'CASH_OUT'
      AND "walletLedgerEntryId" IS NOT NULL
      AND "walletType" = 'CASH_OUT'
      AND "walletSignedAmount" = -"signedAmount"
    )
  );

CREATE UNIQUE INDEX "WalletLedgerEntry_transfer_pair_key"
  ON "WalletLedgerEntry"(
    "id",
    "userId",
    "relatedRoomId",
    "relatedGameSessionId",
    "signedAmount",
    "type"
  );

CREATE UNIQUE INDEX "TableStackLedgerEntry_wallet_transfer_pair_key"
  ON "TableStackLedgerEntry"(
    "walletLedgerEntryId",
    "userId",
    "roomId",
    "gameSessionId",
    "walletSignedAmount",
    "walletType"
  );

ALTER TABLE "TableStackLedgerEntry"
  DROP CONSTRAINT "TableStackLedgerEntry_walletLedgerEntryId_fkey",
  ADD CONSTRAINT "TableStackLedgerEntry_wallet_transfer_pair_fkey"
    FOREIGN KEY (
      "walletLedgerEntryId",
      "userId",
      "roomId",
      "gameSessionId",
      "walletSignedAmount",
      "walletType"
    )
    REFERENCES "WalletLedgerEntry"(
      "id",
      "userId",
      "relatedRoomId",
      "relatedGameSessionId",
      "signedAmount",
      "type"
    )
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Every action actor must be a player in that hand at the same seat. Automatic
-- actions have no clientActionId; user commands retain it for audit only.
ALTER TABLE "HandActionRecord"
  ADD COLUMN "clientActionId" TEXT;

CREATE UNIQUE INDEX "HandPlayerRecord_handId_userId_seatIndex_key"
  ON "HandPlayerRecord"("handId", "userId", "seatIndex");

CREATE UNIQUE INDEX "HandActionRecord_handId_clientActionId_key"
  ON "HandActionRecord"("handId", "clientActionId");

ALTER TABLE "HandActionRecord"
  ADD CONSTRAINT "HandActionRecord_handId_userId_seatIndex_fkey"
    FOREIGN KEY ("handId", "userId", "seatIndex")
    REFERENCES "HandPlayerRecord"("handId", "userId", "seatIndex")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
