ALTER TYPE "WalletLedgerType" ADD VALUE 'HYPOTHETICAL_RUNOUT';
ALTER TYPE "WalletLedgerType" ADD VALUE 'ACTION_TIME_EXTENSION';
ALTER TYPE "IdempotencyScope" ADD VALUE 'TABLE_ACTION_TIME_EXTENSION';

ALTER TABLE "Room"
ADD COLUMN "durationMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN "expiresAt" TIMESTAMP(3);

UPDATE "Room"
SET
  "actionTimeSeconds" = LEAST(45, GREATEST(10, (ROUND("actionTimeSeconds" / 5.0) * 5)::INTEGER)),
  "durationMinutes" = 60,
  "expiresAt" = "createdAt" + INTERVAL '60 minutes',
  "paidCardRevealEnabled" = TRUE,
  "paidCardRevealCost" = CEIL("bigBlind" / 2.0)::INTEGER;

ALTER TABLE "Room"
ALTER COLUMN "expiresAt" SET NOT NULL,
ALTER COLUMN "expiresAt" SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 hour'),
ADD CONSTRAINT "Room_actionTimeSeconds_range_step_check"
  CHECK ("actionTimeSeconds" BETWEEN 10 AND 45 AND MOD("actionTimeSeconds", 5) = 0),
ADD CONSTRAINT "Room_durationMinutes_range_step_check"
  CHECK ("durationMinutes" BETWEEN 30 AND 180 AND MOD("durationMinutes", 30) = 0);

ALTER TABLE "TableSeat"
ADD COLUMN "pendingShowCardIndices" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
ADD CONSTRAINT "TableSeat_pendingShowCardIndices_check"
  CHECK ("pendingShowCardIndices" <@ ARRAY[0, 1]::INTEGER[]);

CREATE TABLE "HypotheticalRunoutPurchase" (
  "id" TEXT NOT NULL,
  "handId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "buyerUserId" TEXT NOT NULL,
  "cost" INTEGER NOT NULL,
  "walletSignedAmount" INTEGER NOT NULL,
  "walletType" "WalletLedgerType" NOT NULL,
  "walletLedgerEntryId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "HypotheticalRunoutPurchase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HypotheticalRunoutPurchase_cost_check" CHECK ("cost" > 0),
  CONSTRAINT "HypotheticalRunoutPurchase_wallet_check" CHECK (
    "walletSignedAmount" = -"cost" AND "walletType" = 'HYPOTHETICAL_RUNOUT'
  )
);

CREATE UNIQUE INDEX "HypotheticalRunoutPurchase_walletLedgerEntryId_key"
ON "HypotheticalRunoutPurchase"("walletLedgerEntryId");
CREATE UNIQUE INDEX "HypotheticalRunoutPurchase_idempotencyKey_key"
ON "HypotheticalRunoutPurchase"("idempotencyKey");
CREATE UNIQUE INDEX "HypotheticalRunoutPurchase_buyerUserId_handId_key"
ON "HypotheticalRunoutPurchase"("buyerUserId", "handId");
CREATE UNIQUE INDEX "HypotheticalRunoutPurchase_wallet_participant_key"
ON "HypotheticalRunoutPurchase"(
  "walletLedgerEntryId", "buyerUserId", "roomId", "handId", "walletSignedAmount", "walletType"
);
CREATE INDEX "HypotheticalRunoutPurchase_handId_idx"
ON "HypotheticalRunoutPurchase"("handId");

ALTER TABLE "HypotheticalRunoutPurchase"
ADD CONSTRAINT "HypotheticalRunoutPurchase_handId_roomId_fkey"
  FOREIGN KEY ("handId", "roomId") REFERENCES "HandRecord"("id", "roomId") ON DELETE RESTRICT ON UPDATE RESTRICT,
ADD CONSTRAINT "HypotheticalRunoutPurchase_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
ADD CONSTRAINT "HypotheticalRunoutPurchase_buyerUserId_fkey"
  FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
ADD CONSTRAINT "HypotheticalRunoutPurchase_handId_buyerUserId_fkey"
  FOREIGN KEY ("handId", "buyerUserId") REFERENCES "HandPlayerRecord"("handId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
ADD CONSTRAINT "HypotheticalRunoutPurchase_wallet_fkey"
  FOREIGN KEY (
    "walletLedgerEntryId", "buyerUserId", "roomId", "handId", "walletSignedAmount", "walletType"
  ) REFERENCES "WalletLedgerEntry"(
    "id", "userId", "relatedRoomId", "relatedHandId", "signedAmount", "type"
  ) ON DELETE RESTRICT ON UPDATE RESTRICT;
