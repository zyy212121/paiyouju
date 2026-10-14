-- Existing OPEN rooms did not have an owner-selected duration before the room
-- clock feature. Give them one full default/configured interval at upgrade time
-- instead of closing them immediately from their historical createdAt value.
UPDATE "Room"
SET "expiresAt" = CURRENT_TIMESTAMP + ("durationMinutes" * INTERVAL '1 minute')
WHERE "status" = 'OPEN'
  AND "expiresAt" <= CURRENT_TIMESTAMP;
