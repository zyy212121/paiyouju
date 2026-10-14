-- Step 6 private history and paid post-hand card reveal.
-- Legacy hands are deliberately non-revealable; only newly settled hands may
-- freeze an enabled configuration and positive cost.

ALTER TYPE "IdempotencyScope" ADD VALUE 'PAID_CARD_REVEAL';

ALTER TABLE "HandRecord"
  ADD COLUMN "paidCardRevealEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "paidCardRevealCost" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "HandRecord_paid_reveal_check"
    CHECK (
      ("paidCardRevealEnabled" = false AND "paidCardRevealCost" = 0)
      OR
      ("paidCardRevealEnabled" = true AND "paidCardRevealCost" > 0 AND "paidCardRevealCost" <= 2000000000)
    );

DROP INDEX "GameSession_userId_startedAt_idx";

CREATE INDEX "GameSession_userId_startedAt_id_idx"
  ON "GameSession"("userId", "startedAt", "id");

DROP INDEX "HandRecord_roomId_finishedAt_idx";

CREATE INDEX "HandRecord_roomId_finishedAt_id_idx"
  ON "HandRecord"("roomId", "finishedAt", "id");

CREATE INDEX "WalletLedgerEntry_userId_sequence_idx"
  ON "WalletLedgerEntry"("userId", "sequence");

DROP INDEX "TableStackLedgerEntry_userId_createdAt_idx";

CREATE INDEX "TableStackLedgerEntry_userId_createdAt_handId_idx"
  ON "TableStackLedgerEntry"("userId", "createdAt", "handId");

CREATE INDEX "HandPlayerRecord_userId_handId_idx"
  ON "HandPlayerRecord"("userId", "handId");

DROP INDEX "HandPlayerRecord_userId_createdAt_idx";

CREATE INDEX "HandPlayerRecord_userId_createdAt_handId_idx"
  ON "HandPlayerRecord"("userId", "createdAt", "handId");

CREATE UNIQUE INDEX "WalletLedgerEntry_paid_reveal_pair_key"
  ON "WalletLedgerEntry"(
    "id",
    "userId",
    "relatedRoomId",
    "relatedHandId",
    "signedAmount",
    "type"
  );

CREATE TABLE "PaidCardReveal" (
  "id" TEXT NOT NULL,
  "handId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "buyerUserId" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "cost" INTEGER NOT NULL,
  "walletSignedAmount" INTEGER NOT NULL,
  "walletType" "WalletLedgerType" NOT NULL,
  "walletLedgerEntryId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaidCardReveal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaidCardReveal_participants_check" CHECK ("buyerUserId" <> "targetUserId"),
  CONSTRAINT "PaidCardReveal_cost_check" CHECK ("cost" > 0 AND "cost" <= 2000000000),
  CONSTRAINT "PaidCardReveal_wallet_pair_check" CHECK (
    "walletType" = 'PAID_CARD_REVEAL'
    AND "walletSignedAmount" = -"cost"
  ),
  CONSTRAINT "PaidCardReveal_fingerprint_check" CHECK (length("requestFingerprint") = 64)
);

CREATE UNIQUE INDEX "PaidCardReveal_walletLedgerEntryId_key"
  ON "PaidCardReveal"("walletLedgerEntryId");

CREATE UNIQUE INDEX "PaidCardReveal_idempotencyKey_key"
  ON "PaidCardReveal"("idempotencyKey");

CREATE UNIQUE INDEX "PaidCardReveal_buyerUserId_handId_targetUserId_key"
  ON "PaidCardReveal"("buyerUserId", "handId", "targetUserId");

CREATE UNIQUE INDEX "PaidCardReveal_wallet_transfer_pair_key"
  ON "PaidCardReveal"(
    "walletLedgerEntryId",
    "buyerUserId",
    "roomId",
    "handId",
    "walletSignedAmount",
    "walletType"
  );

CREATE INDEX "PaidCardReveal_buyerUserId_handId_idx"
  ON "PaidCardReveal"("buyerUserId", "handId");

CREATE INDEX "PaidCardReveal_handId_targetUserId_idx"
  ON "PaidCardReveal"("handId", "targetUserId");

ALTER TABLE "PaidCardReveal"
  ADD CONSTRAINT "PaidCardReveal_handId_roomId_fkey"
    FOREIGN KEY ("handId", "roomId")
    REFERENCES "HandRecord"("id", "roomId")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "PaidCardReveal_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "Room"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "PaidCardReveal_buyerUserId_fkey"
    FOREIGN KEY ("buyerUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "PaidCardReveal_targetUserId_fkey"
    FOREIGN KEY ("targetUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "PaidCardReveal_buyer_participant_fkey"
    FOREIGN KEY ("handId", "buyerUserId")
    REFERENCES "HandPlayerRecord"("handId", "userId")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "PaidCardReveal_target_participant_fkey"
    FOREIGN KEY ("handId", "targetUserId")
    REFERENCES "HandPlayerRecord"("handId", "userId")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "PaidCardReveal_wallet_transfer_pair_fkey"
    FOREIGN KEY (
      "walletLedgerEntryId",
      "buyerUserId",
      "roomId",
      "handId",
      "walletSignedAmount",
      "walletType"
    )
    REFERENCES "WalletLedgerEntry"(
      "id",
      "userId",
      "relatedRoomId",
      "relatedHandId",
      "signedAmount",
      "type"
    )
    ON DELETE RESTRICT ON UPDATE RESTRICT;
