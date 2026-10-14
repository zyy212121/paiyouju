ALTER TYPE "HandActionAutomaticReason"
  ADD VALUE 'NEXT_DECISION_AUTO_CALL';

ALTER TABLE "TableSeat"
  ADD COLUMN "nextActionAutoCallCurrentBet" INTEGER;

ALTER TABLE "TableSeat"
  ADD CONSTRAINT "TableSeat_next_action_auto_call_guard"
  CHECK (
    ("nextActionAutopilotArmed" = true OR "nextActionAutoCallCurrentBet" IS NULL)
    AND ("nextActionAutoCallCurrentBet" IS NULL OR "nextActionAutoCallCurrentBet" > 0)
  );
