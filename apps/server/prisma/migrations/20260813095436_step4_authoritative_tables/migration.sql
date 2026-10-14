-- CreateEnum
CREATE TYPE "TableSeatPlayStatus" AS ENUM ('ACTIVE', 'SIT_OUT', 'SIT_OUT_AFTER_HAND', 'LEAVE_AFTER_HAND');

-- CreateEnum
CREATE TYPE "GameSessionStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "TableStackLedgerType" AS ENUM ('BUY_IN', 'CASH_OUT', 'HAND_RESULT');

-- CreateEnum
CREATE TYPE "HandFinishReason" AS ENUM ('FOLD_TO_WIN', 'SHOWDOWN');

-- CreateEnum
CREATE TYPE "HandStreet" AS ENUM ('PREFLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN');

-- CreateEnum
CREATE TYPE "HandActionType" AS ENUM ('FOLD', 'CHECK', 'CALL', 'BET', 'RAISE_TO', 'ALL_IN');

-- Extend durable request idempotency to all table operations. Financial
-- operations additionally retain their globally unique ledger keys.
ALTER TYPE "IdempotencyScope" ADD VALUE 'TABLE_SEAT_TAKE';
ALTER TYPE "IdempotencyScope" ADD VALUE 'TABLE_BUY_IN';
ALTER TYPE "IdempotencyScope" ADD VALUE 'TABLE_SIT_OUT';
ALTER TYPE "IdempotencyScope" ADD VALUE 'TABLE_RETURN';
ALTER TYPE "IdempotencyScope" ADD VALUE 'TABLE_LEAVE';

-- CreateTable
CREATE TABLE "TableSeat" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "seatIndex" INTEGER NOT NULL,
    "stack" INTEGER NOT NULL,
    "playStatus" "TableSeatPlayStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TableSeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seatIndex" INTEGER NOT NULL,
    "status" "GameSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "totalBuyIn" INTEGER NOT NULL,
    "totalCashOut" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableStackLedgerEntry" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "TableStackLedgerType" NOT NULL,
    "signedAmount" INTEGER NOT NULL,
    "stackBefore" INTEGER NOT NULL,
    "stackAfter" INTEGER NOT NULL,
    "walletLedgerEntryId" TEXT,
    "handId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TableStackLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandRecord" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "handNumber" INTEGER NOT NULL,
    "buttonSeat" INTEGER NOT NULL,
    "smallBlindSeat" INTEGER NOT NULL,
    "bigBlindSeat" INTEGER NOT NULL,
    "smallBlindAmount" INTEGER NOT NULL,
    "bigBlindAmount" INTEGER NOT NULL,
    "board" TEXT[],
    "finishReason" "HandFinishReason" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandPlayerRecord" (
    "id" TEXT NOT NULL,
    "handId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "seatIndex" INTEGER NOT NULL,
    "startingStack" INTEGER NOT NULL,
    "endingStack" INTEGER NOT NULL,
    "committed" INTEGER NOT NULL,
    "netResult" INTEGER NOT NULL,
    "holeCards" TEXT[],
    "holeCardsPublic" BOOLEAN NOT NULL,
    "folded" BOOLEAN NOT NULL,
    "allIn" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandPlayerRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandActionRecord" (
    "id" TEXT NOT NULL,
    "handId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "street" "HandStreet" NOT NULL,
    "userId" TEXT NOT NULL,
    "seatIndex" INTEGER NOT NULL,
    "actionType" "HandActionType" NOT NULL,
    "amount" INTEGER,
    "raiseTo" INTEGER,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "stateVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandActionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandPotRecord" (
    "id" TEXT NOT NULL,
    "handId" TEXT NOT NULL,
    "potIndex" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "contributors" TEXT[],
    "eligiblePlayers" TEXT[],
    "winners" TEXT[],
    "oddChipRecipients" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandPotRecord_pkey" PRIMARY KEY ("id")
);

-- Domain checks remain in PostgreSQL as the final defence if an application
-- caller bypasses the table services. All point values intentionally remain
-- below PostgreSQL INTEGER's upper bound.
ALTER TABLE "TableSeat"
  ADD CONSTRAINT "TableSeat_seat_index_check"
    CHECK ("seatIndex" BETWEEN 0 AND 8),
  ADD CONSTRAINT "TableSeat_stack_range_check"
    CHECK ("stack" BETWEEN 0 AND 2000000000),
  ADD CONSTRAINT "TableSeat_version_nonnegative_check"
    CHECK ("version" >= 0);

ALTER TABLE "GameSession"
  ADD CONSTRAINT "GameSession_seat_index_check"
    CHECK ("seatIndex" BETWEEN 0 AND 8),
  ADD CONSTRAINT "GameSession_buy_in_range_check"
    CHECK ("totalBuyIn" BETWEEN 1 AND 2000000000),
  ADD CONSTRAINT "GameSession_cash_out_range_check"
    CHECK ("totalCashOut" BETWEEN 0 AND 2000000000),
  ADD CONSTRAINT "GameSession_lifecycle_check"
    CHECK (
      ("status" = 'ACTIVE' AND "endedAt" IS NULL)
      OR
      ("status" = 'CLOSED' AND "endedAt" IS NOT NULL)
    );

ALTER TABLE "TableStackLedgerEntry"
  ADD CONSTRAINT "TableStackLedgerEntry_sequence_positive_check"
    CHECK ("sequence" > 0),
  ADD CONSTRAINT "TableStackLedgerEntry_stack_before_range_check"
    CHECK ("stackBefore" BETWEEN 0 AND 2000000000),
  ADD CONSTRAINT "TableStackLedgerEntry_stack_after_range_check"
    CHECK ("stackAfter" BETWEEN 0 AND 2000000000),
  ADD CONSTRAINT "TableStackLedgerEntry_stack_equation_check"
    CHECK ("stackAfter" = "stackBefore" + "signedAmount"),
  ADD CONSTRAINT "TableStackLedgerEntry_type_link_check"
    CHECK (
      (
        "type" = 'BUY_IN'
        AND "signedAmount" > 0
        AND "walletLedgerEntryId" IS NOT NULL
        AND "handId" IS NULL
      )
      OR
      (
        "type" = 'CASH_OUT'
        AND "signedAmount" < 0
        AND "stackAfter" = 0
        AND "walletLedgerEntryId" IS NOT NULL
        AND "handId" IS NULL
      )
      OR
      (
        "type" = 'HAND_RESULT'
        AND "walletLedgerEntryId" IS NULL
        AND "handId" IS NOT NULL
      )
    );

ALTER TABLE "HandRecord"
  ADD CONSTRAINT "HandRecord_hand_number_positive_check"
    CHECK ("handNumber" > 0),
  ADD CONSTRAINT "HandRecord_seats_check"
    CHECK (
      "buttonSeat" BETWEEN 0 AND 8
      AND "smallBlindSeat" BETWEEN 0 AND 8
      AND "bigBlindSeat" BETWEEN 0 AND 8
    ),
  ADD CONSTRAINT "HandRecord_blinds_check"
    CHECK (
      "smallBlindAmount" BETWEEN 1 AND 2000000000
      AND "bigBlindAmount" > "smallBlindAmount"
      AND "bigBlindAmount" <= 2000000000
    ),
  ADD CONSTRAINT "HandRecord_board_check"
    CHECK (
      cardinality("board") BETWEEN 0 AND 5
      AND array_to_string("board", ',') ~ '^([2-9TJQKA][cdhs](,[2-9TJQKA][cdhs])*)?$'
      AND ("finishReason" <> 'SHOWDOWN' OR cardinality("board") = 5)
    ),
  ADD CONSTRAINT "HandRecord_timestamps_check"
    CHECK ("finishedAt" >= "startedAt");

ALTER TABLE "HandPlayerRecord"
  ADD CONSTRAINT "HandPlayerRecord_seat_index_check"
    CHECK ("seatIndex" BETWEEN 0 AND 8),
  ADD CONSTRAINT "HandPlayerRecord_stack_range_check"
    CHECK (
      "startingStack" BETWEEN 0 AND 2000000000
      AND "endingStack" BETWEEN 0 AND 2000000000
      AND "committed" BETWEEN 0 AND 2000000000
    ),
  ADD CONSTRAINT "HandPlayerRecord_result_equation_check"
    CHECK ("netResult" = "endingStack" - "startingStack"),
  ADD CONSTRAINT "HandPlayerRecord_hole_cards_check"
    CHECK (
      cardinality("holeCards") = 2
      AND array_to_string("holeCards", ',') ~ '^[2-9TJQKA][cdhs],[2-9TJQKA][cdhs]$'
    );

ALTER TABLE "HandActionRecord"
  ADD CONSTRAINT "HandActionRecord_sequence_positive_check"
    CHECK ("sequence" > 0),
  ADD CONSTRAINT "HandActionRecord_seat_index_check"
    CHECK ("seatIndex" BETWEEN 0 AND 8),
  ADD CONSTRAINT "HandActionRecord_state_version_positive_check"
    CHECK ("stateVersion" > 0),
  ADD CONSTRAINT "HandActionRecord_amount_range_check"
    CHECK (
      ("amount" IS NULL OR "amount" BETWEEN 0 AND 2000000000)
      AND ("raiseTo" IS NULL OR "raiseTo" BETWEEN 1 AND 2000000000)
    ),
  ADD CONSTRAINT "HandActionRecord_shape_check"
    CHECK (
      ("actionType" = 'RAISE_TO' AND "raiseTo" IS NOT NULL)
      OR
      ("actionType" <> 'RAISE_TO' AND "raiseTo" IS NULL)
    );

ALTER TABLE "HandPotRecord"
  ADD CONSTRAINT "HandPotRecord_index_nonnegative_check"
    CHECK ("potIndex" >= 0),
  ADD CONSTRAINT "HandPotRecord_amount_positive_check"
    CHECK ("amount" BETWEEN 1 AND 2000000000),
  ADD CONSTRAINT "HandPotRecord_participants_check"
    CHECK (
      cardinality("contributors") >= 1
      AND cardinality("eligiblePlayers") >= 1
      AND cardinality("winners") >= 1
    );

-- CreateIndex
CREATE UNIQUE INDEX "TableSeat_gameSessionId_key" ON "TableSeat"("gameSessionId");

-- CreateIndex
CREATE INDEX "TableSeat_userId_idx" ON "TableSeat"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TableSeat_roomId_seatIndex_key" ON "TableSeat"("roomId", "seatIndex");

-- CreateIndex
CREATE UNIQUE INDEX "TableSeat_roomId_userId_key" ON "TableSeat"("roomId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TableSeat_id_gameSessionId_userId_roomId_key" ON "TableSeat"("id", "gameSessionId", "userId", "roomId");

-- CreateIndex
CREATE INDEX "GameSession_roomId_status_idx" ON "GameSession"("roomId", "status");

-- CreateIndex
CREATE INDEX "GameSession_userId_startedAt_idx" ON "GameSession"("userId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GameSession_id_roomId_userId_key" ON "GameSession"("id", "roomId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TableStackLedgerEntry_walletLedgerEntryId_key" ON "TableStackLedgerEntry"("walletLedgerEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "TableStackLedgerEntry_idempotencyKey_key" ON "TableStackLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TableStackLedgerEntry_roomId_createdAt_idx" ON "TableStackLedgerEntry"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "TableStackLedgerEntry_userId_createdAt_idx" ON "TableStackLedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TableStackLedgerEntry_handId_idx" ON "TableStackLedgerEntry"("handId");

-- CreateIndex
CREATE UNIQUE INDEX "TableStackLedgerEntry_gameSessionId_sequence_key" ON "TableStackLedgerEntry"("gameSessionId", "sequence");

-- CreateIndex
CREATE INDEX "HandRecord_roomId_finishedAt_idx" ON "HandRecord"("roomId", "finishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HandRecord_roomId_handNumber_key" ON "HandRecord"("roomId", "handNumber");

-- CreateIndex
CREATE INDEX "HandPlayerRecord_userId_createdAt_idx" ON "HandPlayerRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "HandPlayerRecord_gameSessionId_idx" ON "HandPlayerRecord"("gameSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "HandPlayerRecord_handId_userId_key" ON "HandPlayerRecord"("handId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "HandPlayerRecord_handId_seatIndex_key" ON "HandPlayerRecord"("handId", "seatIndex");

-- CreateIndex
CREATE INDEX "HandActionRecord_userId_createdAt_idx" ON "HandActionRecord"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HandActionRecord_handId_sequence_key" ON "HandActionRecord"("handId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "HandPotRecord_handId_potIndex_key" ON "HandPotRecord"("handId", "potIndex");

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_relatedGameSessionId_fkey" FOREIGN KEY ("relatedGameSessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_relatedHandId_fkey" FOREIGN KEY ("relatedHandId") REFERENCES "HandRecord"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TableSeat" ADD CONSTRAINT "TableSeat_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TableSeat" ADD CONSTRAINT "TableSeat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TableSeat" ADD CONSTRAINT "TableSeat_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TableStackLedgerEntry" ADD CONSTRAINT "TableStackLedgerEntry_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TableStackLedgerEntry" ADD CONSTRAINT "TableStackLedgerEntry_gameSessionId_roomId_userId_fkey" FOREIGN KEY ("gameSessionId", "roomId", "userId") REFERENCES "GameSession"("id", "roomId", "userId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TableStackLedgerEntry" ADD CONSTRAINT "TableStackLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TableStackLedgerEntry" ADD CONSTRAINT "TableStackLedgerEntry_walletLedgerEntryId_fkey" FOREIGN KEY ("walletLedgerEntryId") REFERENCES "WalletLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TableStackLedgerEntry" ADD CONSTRAINT "TableStackLedgerEntry_handId_fkey" FOREIGN KEY ("handId") REFERENCES "HandRecord"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "HandRecord" ADD CONSTRAINT "HandRecord_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "HandPlayerRecord" ADD CONSTRAINT "HandPlayerRecord_handId_fkey" FOREIGN KEY ("handId") REFERENCES "HandRecord"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "HandPlayerRecord" ADD CONSTRAINT "HandPlayerRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "HandPlayerRecord" ADD CONSTRAINT "HandPlayerRecord_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "HandActionRecord" ADD CONSTRAINT "HandActionRecord_handId_fkey" FOREIGN KEY ("handId") REFERENCES "HandRecord"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "HandActionRecord" ADD CONSTRAINT "HandActionRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "HandPotRecord" ADD CONSTRAINT "HandPotRecord_handId_fkey" FOREIGN KEY ("handId") REFERENCES "HandRecord"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
