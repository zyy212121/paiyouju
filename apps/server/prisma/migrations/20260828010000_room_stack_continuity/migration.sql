-- A player's table points belong to one room-scoped GameSession. Standing up
-- detaches the stack from a seat; it does not close the session or buy in again.
ALTER TABLE "Room"
ADD COLUMN "initialBuyIn" INTEGER;

UPDATE "Room"
SET "initialBuyIn" = LEAST(
  "maximumBuyIn",
  GREATEST(
    "minimumBuyIn",
    LEAST(2000000000::BIGINT, "bigBlind"::BIGINT * 100)::INTEGER
  )
);

ALTER TABLE "Room"
ALTER COLUMN "initialBuyIn" SET NOT NULL,
ALTER COLUMN "initialBuyIn" SET DEFAULT 2000,
ADD CONSTRAINT "Room_initialBuyIn_check"
  CHECK ("initialBuyIn" BETWEEN 1 AND 2000000000);

ALTER TABLE "GameSession"
ADD COLUMN "detachedStack" INTEGER,
ADD CONSTRAINT "GameSession_detachedStack_check"
  CHECK ("detachedStack" IS NULL OR "detachedStack" BETWEEN 0 AND 2000000000);

-- Defensive recovery for any legacy ACTIVE session whose seat was already
-- removed: the last durable table-ledger balance is the preserved stack.
UPDATE "GameSession" AS session
SET "detachedStack" = (
  SELECT entry."stackAfter"
  FROM "TableStackLedgerEntry" AS entry
  WHERE entry."gameSessionId" = session."id"
  ORDER BY entry."sequence" DESC
  LIMIT 1
)
WHERE session."status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM "TableSeat" AS seat
    WHERE seat."gameSessionId" = session."id"
  );

CREATE UNIQUE INDEX "GameSession_roomId_userId_active_key"
  ON "GameSession"("roomId", "userId")
  WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "TableSeat_gameSessionId_roomId_userId_key"
  ON "TableSeat"("gameSessionId", "roomId", "userId");

-- Seat index is hand/seat history, not the identity of a room session. These
-- replacement foreign keys retain room/user isolation while allowing re-seat.
ALTER TABLE "TableSeat"
  DROP CONSTRAINT "TableSeat_gameSessionId_roomId_userId_seatIndex_fkey",
  ADD CONSTRAINT "TableSeat_gameSessionId_roomId_userId_fkey"
    FOREIGN KEY ("gameSessionId", "roomId", "userId")
    REFERENCES "GameSession"("id", "roomId", "userId")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "HandPlayerRecord"
  DROP CONSTRAINT "HandPlayerRecord_gameSessionId_roomId_userId_seatIndex_fkey",
  ADD CONSTRAINT "HandPlayerRecord_gameSessionId_roomId_userId_fkey"
    FOREIGN KEY ("gameSessionId", "roomId", "userId")
    REFERENCES "GameSession"("id", "roomId", "userId")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
