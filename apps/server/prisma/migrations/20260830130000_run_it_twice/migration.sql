ALTER TYPE "IdempotencyScope" ADD VALUE 'TABLE_RUNOUT_CHOICE';

ALTER TABLE "Room"
  ADD COLUMN "runItTwiceEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT "Room_run_it_twice_mode_check"
    CHECK ("specialMode" = 'NORMAL' OR "runItTwiceEnabled" = false);

ALTER TABLE "HandRecord"
  ADD COLUMN "runoutCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "runoutVotes" JSONB,
  ADD CONSTRAINT "HandRecord_runout_count_check" CHECK ("runoutCount" IN (1, 2)),
  ADD CONSTRAINT "HandRecord_runout_votes_shape_check"
    CHECK ("runoutCount" = 1 OR "runoutVotes" IS NOT NULL);

CREATE TABLE "HandRunoutRecord" (
  "id" TEXT NOT NULL,
  "handId" TEXT NOT NULL,
  "runoutIndex" INTEGER NOT NULL,
  "board" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HandRunoutRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HandRunoutRecord_shape_check" CHECK ("runoutIndex" IN (1, 2) AND cardinality("board") = 5),
  CONSTRAINT "HandRunoutRecord_handId_fkey" FOREIGN KEY ("handId") REFERENCES "HandRecord"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "HandRunoutRecord_handId_runoutIndex_key" ON "HandRunoutRecord"("handId", "runoutIndex");
CREATE INDEX "HandRunoutRecord_handId_idx" ON "HandRunoutRecord"("handId");

CREATE TABLE "HandRunoutPotRecord" (
  "id" TEXT NOT NULL,
  "handId" TEXT NOT NULL,
  "runoutIndex" INTEGER NOT NULL,
  "potIndex" INTEGER NOT NULL,
  "amount" INTEGER NOT NULL,
  "contributors" TEXT[] NOT NULL,
  "eligiblePlayers" TEXT[] NOT NULL,
  "winners" TEXT[] NOT NULL,
  "oddChipRecipients" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HandRunoutPotRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HandRunoutPotRecord_shape_check" CHECK ("runoutIndex" IN (1, 2) AND "potIndex" >= 0 AND "amount" >= 0),
  CONSTRAINT "HandRunoutPotRecord_runout_fkey" FOREIGN KEY ("handId", "runoutIndex") REFERENCES "HandRunoutRecord"("handId", "runoutIndex") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "HandRunoutPotRecord_handId_runoutIndex_potIndex_key" ON "HandRunoutPotRecord"("handId", "runoutIndex", "potIndex");
CREATE INDEX "HandRunoutPotRecord_handId_runoutIndex_idx" ON "HandRunoutPotRecord"("handId", "runoutIndex");
