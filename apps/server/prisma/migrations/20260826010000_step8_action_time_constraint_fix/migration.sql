-- Step 3 accepted a sparse legacy action-time list. Step 6.5 added the
-- authoritative 10..45 second, five-second-step constraint but retained the
-- old constraint, making 10/25/35/40 impossible to persist. Keep the newer
-- constraint and remove only the obsolete overlapping guard.
ALTER TABLE "Room"
DROP CONSTRAINT "Room_action_time_check";
