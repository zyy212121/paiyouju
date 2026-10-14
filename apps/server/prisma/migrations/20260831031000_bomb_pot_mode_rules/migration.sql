ALTER TABLE "Room"
  ADD COLUMN "bombPotBlindMultiplier" INTEGER,
  ADD COLUMN "bombPotIntervalMinutes" INTEGER,
  ADD COLUMN "bombPotNextAt" TIMESTAMP(3);

ALTER TABLE "HandRecord"
  ADD COLUMN "bombPotBlindAmount" INTEGER;

ALTER TABLE "Room" DROP CONSTRAINT "Room_squid_mode_shape_check";
ALTER TABLE "Room" ADD CONSTRAINT "Room_squid_mode_shape_check" CHECK (
  (
    "specialMode" = 'BOMB_POT'
    AND "bombPotBlindMultiplier" BETWEEN 1 AND 10
    AND (
      "bombPotIntervalMinutes" = 1
      OR ("bombPotIntervalMinutes" BETWEEN 5 AND 30 AND MOD("bombPotIntervalMinutes", 5) = 0)
    )
    AND "squidStake" IS NULL
  )
  OR
  (
    "specialMode" <> 'BOMB_POT'
    AND "bombPotBlindMultiplier" IS NULL
    AND "bombPotIntervalMinutes" IS NULL
    AND "bombPotNextAt" IS NULL
    AND (
      ("specialMode" IN ('NORMAL', 'SHORT_DECK') AND "squidStake" IS NULL)
      OR ("specialMode" = 'SQUID' AND "squidStake" BETWEEN 1 AND 2000000000)
    )
  )
);

ALTER TABLE "HandRecord" ADD CONSTRAINT "HandRecord_bombPotBlindAmount_check"
  CHECK ("bombPotBlindAmount" IS NULL OR "bombPotBlindAmount" BETWEEN 1 AND 2000000000);
