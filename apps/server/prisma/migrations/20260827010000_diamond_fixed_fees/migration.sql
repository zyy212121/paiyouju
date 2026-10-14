ALTER TYPE "WalletLedgerType" ADD VALUE 'HAND_ENTRY_FEE';

-- The paid historical-hand reveal is a forced 5x diamond action. Existing
-- rooms adopt the new rate immediately; already-created hand records retain
-- their frozen historical rate so completed accounting is never rewritten.
UPDATE "Room"
SET "paidCardRevealEnabled" = TRUE,
    "paidCardRevealCost" = 50
WHERE "paidCardRevealEnabled" IS DISTINCT FROM TRUE
   OR "paidCardRevealCost" <> 50;
