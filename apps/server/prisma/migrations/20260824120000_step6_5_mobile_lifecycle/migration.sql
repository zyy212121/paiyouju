-- Step 6.5 mobile table lifecycle, post-hand review, hand-level history,
-- room archival and phone-login foundation. This migration is append-only.

ALTER TYPE "IdempotencyScope" ADD VALUE 'PAID_HAND_REVEAL';
ALTER TYPE "IdempotencyScope" ADD VALUE 'HYPOTHETICAL_RUNOUT';
ALTER TYPE "IdempotencyScope" ADD VALUE 'ROOM_ARCHIVE';
ALTER TYPE "IdempotencyScope" ADD VALUE 'PHONE_BIND';
ALTER TYPE "IdempotencyScope" ADD VALUE 'TABLE_START';
ALTER TYPE "IdempotencyScope" ADD VALUE 'TABLE_AUTOPILOT_ARM';
ALTER TYPE "IdempotencyScope" ADD VALUE 'TABLE_AUTOPILOT_CANCEL';
ALTER TYPE "IdempotencyScope" ADD VALUE 'TABLE_RESERVE_AWAY';
ALTER TYPE "IdempotencyScope" ADD VALUE 'TABLE_REVEAL_OWN_CARDS';

ALTER TYPE "TableSeatPlayStatus" ADD VALUE 'RESERVED_AWAY';
ALTER TYPE "TableSeatPlayStatus" ADD VALUE 'BUSTED_WAITING_REBUY';
ALTER TYPE "TableRuntimeStatus" ADD VALUE 'POST_HAND_REVIEW';

CREATE TYPE "HandActionAutomaticReason" AS ENUM (
  'TURN_TIMEOUT',
  'NEXT_DECISION_AUTOPILOT',
  'RESERVED_AWAY'
);

CREATE TYPE "HoleCardsPublicReason" AS ENUM ('SHOWDOWN', 'VOLUNTARY');

CREATE TYPE "HypotheticalRunoutGenerationSource" AS ENUM (
  'ORIGINAL_REMAINING_DECK',
  'CSPRNG_LEGACY_FALLBACK'
);

ALTER TABLE "User"
  ADD COLUMN "phoneNumber" VARCHAR(11),
  ADD CONSTRAINT "User_phone_number_format_check"
    CHECK ("phoneNumber" IS NULL OR "phoneNumber" ~ '^1[0-9]{10}$');

CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");

ALTER TABLE "Room"
  ADD COLUMN "requiresManualStart" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "tableStartedAt" TIMESTAMPTZ,
  ADD COLUMN "archivedAt" TIMESTAMPTZ,
  ADD COLUMN "archivedByUserId" TEXT,
  ADD CONSTRAINT "Room_archive_pair_check"
    CHECK (
      ("archivedAt" IS NULL AND "archivedByUserId" IS NULL)
      OR
      ("archivedAt" IS NOT NULL AND "archivedByUserId" IS NOT NULL AND "status" = 'CLOSED')
    ),
  ADD CONSTRAINT "Room_archivedByUserId_fkey"
    FOREIGN KEY ("archivedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "Room_archivedAt_idx" ON "Room"("archivedAt");
CREATE INDEX "Room_status_closedAt_id_idx" ON "Room"("status", "closedAt", "id");

ALTER TABLE "TableSeat"
  ADD COLUMN "nextActionAutopilotArmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reservedAwayEndsAt" TIMESTAMPTZ,
  ADD CONSTRAINT "TableSeat_reserved_away_pair_check"
    CHECK (
      ("playStatus"::text = 'RESERVED_AWAY' AND "reservedAwayEndsAt" IS NOT NULL)
      OR
      ("playStatus"::text <> 'RESERVED_AWAY' AND "reservedAwayEndsAt" IS NULL)
    );

ALTER TABLE "HandRecord"
  ADD COLUMN "remainingDeck" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "reviewEndsAt" TIMESTAMPTZ;

ALTER TABLE "HandPlayerRecord"
  ADD COLUMN "holeCardsPublicReason" "HoleCardsPublicReason",
  ADD COLUMN "voluntarilyRevealedAt" TIMESTAMPTZ;

UPDATE "HandPlayerRecord"
SET "holeCardsPublicReason" = 'SHOWDOWN'
WHERE "holeCardsPublic" = true;

ALTER TABLE "HandPlayerRecord"
  ADD CONSTRAINT "HandPlayerRecord_public_reason_check"
    CHECK (
      (
        "holeCardsPublic" = false
        AND "holeCardsPublicReason" IS NULL
        AND "voluntarilyRevealedAt" IS NULL
      )
      OR
      (
        "holeCardsPublic" = true
        AND "holeCardsPublicReason" = 'SHOWDOWN'
        AND "voluntarilyRevealedAt" IS NULL
      )
      OR
      (
        "holeCardsPublic" = true
        AND "holeCardsPublicReason" = 'VOLUNTARY'
        AND "voluntarilyRevealedAt" IS NOT NULL
      )
    );

ALTER TABLE "HandActionRecord"
  ADD COLUMN "automaticReason" "HandActionAutomaticReason";

UPDATE "HandActionRecord"
SET "automaticReason" = 'TURN_TIMEOUT'
WHERE "automatic" = true;

ALTER TABLE "HandActionRecord"
  ADD CONSTRAINT "HandActionRecord_automatic_reason_check"
    CHECK (
      ("automatic" = true AND "automaticReason" IS NOT NULL)
      OR ("automatic" = false AND "automaticReason" IS NULL)
    );

CREATE TABLE "PaidHandRevealPurchase" (
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
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaidHandRevealPurchase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaidHandRevealPurchase_cost_check"
    CHECK (
      "cost" > 0
      AND "cost" <= 2000000000
      AND "walletSignedAmount" = -"cost"
      AND "walletType" = 'PAID_CARD_REVEAL'
    ),
  CONSTRAINT "PaidHandRevealPurchase_hand_room_fkey"
    FOREIGN KEY ("handId", "roomId") REFERENCES "HandRecord"("id", "roomId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PaidHandRevealPurchase_room_fkey"
    FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PaidHandRevealPurchase_buyer_fkey"
    FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PaidHandRevealPurchase_buyer_participant_fkey"
    FOREIGN KEY ("handId", "buyerUserId") REFERENCES "HandPlayerRecord"("handId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PaidHandRevealPurchase_wallet_transfer_pair_fkey"
    FOREIGN KEY (
      "walletLedgerEntryId", "buyerUserId", "roomId", "handId", "walletSignedAmount", "walletType"
    ) REFERENCES "WalletLedgerEntry"(
      "id", "userId", "relatedRoomId", "relatedHandId", "signedAmount", "type"
    ) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "PaidHandRevealPurchase_walletLedgerEntryId_key"
  ON "PaidHandRevealPurchase"("walletLedgerEntryId");
CREATE UNIQUE INDEX "PaidHandRevealPurchase_idempotencyKey_key"
  ON "PaidHandRevealPurchase"("idempotencyKey");
CREATE UNIQUE INDEX "PaidHandRevealPurchase_buyerUserId_handId_key"
  ON "PaidHandRevealPurchase"("buyerUserId", "handId");
CREATE UNIQUE INDEX "PaidHandRevealPurchase_wallet_transfer_pair_key"
  ON "PaidHandRevealPurchase"(
    "walletLedgerEntryId", "buyerUserId", "roomId", "handId", "walletSignedAmount", "walletType"
  );
CREATE INDEX "PaidHandRevealPurchase_handId_idx"
  ON "PaidHandRevealPurchase"("handId");

CREATE TABLE "HandHypotheticalRunout" (
  "id" TEXT NOT NULL,
  "handId" TEXT NOT NULL,
  "cards" TEXT[] NOT NULL,
  "generationSource" "HypotheticalRunoutGenerationSource" NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HandHypotheticalRunout_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HandHypotheticalRunout_cards_check"
    CHECK (cardinality("cards") BETWEEN 1 AND 5),
  CONSTRAINT "HandHypotheticalRunout_hand_fkey"
    FOREIGN KEY ("handId") REFERENCES "HandRecord"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "HandHypotheticalRunout_handId_key"
  ON "HandHypotheticalRunout"("handId");
