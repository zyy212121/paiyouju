-- Step 3 allowed a room's per-seat maximum to multiply beyond the Step 4
-- INTEGER-backed whole-table limit. Normalize those legacy configurations
-- before the following migration installs the aggregate CHECK. Pausing an
-- affected open room makes the compatibility change visible before another
-- hand can begin.

WITH unsafe_rooms AS (
  SELECT
    "id",
    FLOOR(2000000000::NUMERIC / "maxSeats")::INTEGER AS "safeMaximum"
  FROM "Room"
  WHERE "maximumBuyIn" * "maxSeats"::BIGINT > 2000000000
)
UPDATE "Room" AS room
SET
  "smallBlind" = LEAST(
    room."smallBlind",
    LEAST(room."bigBlind", unsafe."safeMaximum") - 1
  ),
  "bigBlind" = LEAST(room."bigBlind", unsafe."safeMaximum"),
  "minimumBuyIn" = GREATEST(
    LEAST(room."bigBlind", unsafe."safeMaximum"),
    LEAST(room."minimumBuyIn", unsafe."safeMaximum")
  ),
  "maximumBuyIn" = unsafe."safeMaximum",
  "nextHandPaused" = CASE
    WHEN room."status" = 'OPEN' THEN TRUE
    ELSE room."nextHandPaused"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
FROM unsafe_rooms AS unsafe
WHERE room."id" = unsafe."id";
