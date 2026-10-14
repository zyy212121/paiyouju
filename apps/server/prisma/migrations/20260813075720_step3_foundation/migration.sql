-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "WalletLedgerType" AS ENUM ('INITIAL_GRANT', 'BUY_IN', 'CASH_OUT', 'PAID_CARD_REVEAL', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('OPEN', 'CLOSING', 'CLOSED');

-- CreateEnum
CREATE TYPE "RoomMemberRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "IdempotencyScope" AS ENUM ('ROOM_CREATE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "usernameNormalized" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletLedgerEntry" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "WalletLedgerType" NOT NULL,
    "signedAmount" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "relatedRoomId" TEXT,
    "relatedGameSessionId" TEXT,
    "relatedHandId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "roomCode" CHAR(6) NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "maxSeats" INTEGER NOT NULL,
    "smallBlind" INTEGER NOT NULL,
    "bigBlind" INTEGER NOT NULL,
    "minimumBuyIn" INTEGER NOT NULL,
    "maximumBuyIn" INTEGER NOT NULL,
    "actionTimeSeconds" INTEGER NOT NULL,
    "passwordHash" TEXT,
    "paidCardRevealEnabled" BOOLEAN NOT NULL DEFAULT false,
    "paidCardRevealCost" INTEGER NOT NULL DEFAULT 0,
    "nextHandPaused" BOOLEAN NOT NULL DEFAULT false,
    "status" "RoomStatus" NOT NULL DEFAULT 'OPEN',
    "closeRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomMember" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "RoomMemberRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestIdempotency" (
    "id" TEXT NOT NULL,
    "scope" "IdempotencyScope" NOT NULL,
    "actorId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resourceId" TEXT,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestIdempotency_pkey" PRIMARY KEY ("id")
);

-- Domain checks are kept in PostgreSQL as a second line of defence behind
-- runtime validation. Points deliberately remain below PostgreSQL INT max.
ALTER TABLE "Wallet"
  ADD CONSTRAINT "Wallet_balance_range_check"
    CHECK ("balance" BETWEEN 0 AND 2000000000),
  ADD CONSTRAINT "Wallet_version_nonnegative_check"
    CHECK ("version" >= 0);

ALTER TABLE "WalletLedgerEntry"
  ADD CONSTRAINT "WalletLedgerEntry_sequence_positive_check"
    CHECK ("sequence" > 0),
  ADD CONSTRAINT "WalletLedgerEntry_amount_nonzero_check"
    CHECK ("signedAmount" <> 0),
  ADD CONSTRAINT "WalletLedgerEntry_balance_before_range_check"
    CHECK ("balanceBefore" BETWEEN 0 AND 2000000000),
  ADD CONSTRAINT "WalletLedgerEntry_balance_after_range_check"
    CHECK ("balanceAfter" BETWEEN 0 AND 2000000000),
  ADD CONSTRAINT "WalletLedgerEntry_balance_equation_check"
    CHECK ("balanceAfter" = "balanceBefore" + "signedAmount");

ALTER TABLE "Room"
  ADD CONSTRAINT "Room_code_format_check"
    CHECK ("roomCode" ~ '^[0-9]{6}$'),
  ADD CONSTRAINT "Room_name_length_check"
    CHECK (char_length("name") BETWEEN 1 AND 40),
  ADD CONSTRAINT "Room_max_seats_check"
    CHECK ("maxSeats" BETWEEN 2 AND 9),
  ADD CONSTRAINT "Room_blinds_check"
    CHECK ("smallBlind" >= 1 AND "bigBlind" > "smallBlind"),
  ADD CONSTRAINT "Room_buy_in_check"
    CHECK (
      "minimumBuyIn" >= "bigBlind"
      AND "maximumBuyIn" >= "minimumBuyIn"
      AND "maximumBuyIn" <= 2000000000
    ),
  ADD CONSTRAINT "Room_action_time_check"
    CHECK ("actionTimeSeconds" IN (15, 20, 30, 45, 60)),
  ADD CONSTRAINT "Room_paid_reveal_check"
    CHECK (
      (NOT "paidCardRevealEnabled" AND "paidCardRevealCost" = 0)
      OR
      ("paidCardRevealEnabled" AND "paidCardRevealCost" BETWEEN 1 AND 2000000000)
    ),
  ADD CONSTRAINT "Room_closed_timestamps_check"
    CHECK (
      ("status" = 'CLOSED' AND "closedAt" IS NOT NULL AND "closeRequestedAt" IS NOT NULL)
      OR
      ("status" <> 'CLOSED' AND "closedAt" IS NULL)
    );

-- CreateIndex
CREATE UNIQUE INDEX "User_usernameNormalized_key" ON "User"("usernameNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");

-- CreateIndex
CREATE INDEX "UserSession_userId_expiresAt_idx" ON "UserSession"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletLedgerEntry_idempotencyKey_key" ON "WalletLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_userId_createdAt_id_idx" ON "WalletLedgerEntry"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_relatedRoomId_idx" ON "WalletLedgerEntry"("relatedRoomId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletLedgerEntry_walletId_sequence_key" ON "WalletLedgerEntry"("walletId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Room_roomCode_key" ON "Room"("roomCode");

-- CreateIndex
CREATE INDEX "Room_ownerId_createdAt_idx" ON "Room"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "RoomMember_userId_joinedAt_idx" ON "RoomMember"("userId", "joinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RoomMember_roomId_userId_key" ON "RoomMember"("roomId", "userId");

-- CreateIndex
CREATE INDEX "RequestIdempotency_actorId_createdAt_idx" ON "RequestIdempotency"("actorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RequestIdempotency_scope_actorId_key_key" ON "RequestIdempotency"("scope", "actorId", "key");

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_relatedRoomId_fkey" FOREIGN KEY ("relatedRoomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RequestIdempotency" ADD CONSTRAINT "RequestIdempotency_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
