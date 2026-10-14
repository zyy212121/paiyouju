-- A HAND_RESULT ledger must belong to the exact participant and GameSession
-- recorded for that hand. BUY_IN/CASH_OUT rows keep handId NULL, so the
-- optional composite foreign key does not apply to those transfer types.

CREATE UNIQUE INDEX "HandPlayerRecord_handId_roomId_userId_gameSessionId_key"
  ON "HandPlayerRecord"("handId", "roomId", "userId", "gameSessionId");

ALTER TABLE "TableStackLedgerEntry"
  ADD CONSTRAINT "TableStackLedgerEntry_hand_participant_fkey"
    FOREIGN KEY ("handId", "roomId", "userId", "gameSessionId")
    REFERENCES "HandPlayerRecord"("handId", "roomId", "userId", "gameSessionId")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
