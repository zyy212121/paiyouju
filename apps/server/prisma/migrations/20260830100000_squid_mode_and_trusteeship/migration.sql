CREATE TYPE "RoomSpecialMode" AS ENUM ('NORMAL', 'SQUID');

ALTER TYPE "IdempotencyScope" ADD VALUE 'TABLE_TRUSTEESHIP_SET';
ALTER TYPE "HandActionAutomaticReason" ADD VALUE 'TRUSTEESHIP';
ALTER TYPE "TableStackLedgerType" ADD VALUE 'SQUID_SETTLEMENT';

ALTER TABLE "Room"
  ADD COLUMN "specialMode" "RoomSpecialMode" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "squidStake" INTEGER,
  ADD COLUMN "squidRoundNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "squidRoundGraceEndsAt" TIMESTAMPTZ,
  ADD COLUMN "squidSettlementPending" BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT "Room_squid_mode_shape_check"
    CHECK (
      ("specialMode" = 'NORMAL' AND "squidStake" IS NULL)
      OR
      ("specialMode" = 'SQUID' AND "squidStake" BETWEEN 1 AND 2000000000)
    ),
  ADD CONSTRAINT "Room_squid_round_state_check"
    CHECK (
      "squidRoundNumber" > 0
      AND ("specialMode" = 'SQUID' OR ("squidRoundGraceEndsAt" IS NULL AND "squidSettlementPending" = false))
      AND NOT ("squidRoundGraceEndsAt" IS NOT NULL AND "squidSettlementPending" = true)
    );

ALTER TABLE "TableSeat"
  ADD COLUMN "squidMarked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "squidRoundParticipant" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "trusteeshipEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT "TableSeat_squid_state_check"
    CHECK ("squidMarked" = false OR "squidRoundParticipant" = true);
