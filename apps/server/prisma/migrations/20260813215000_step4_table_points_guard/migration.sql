-- Keep the maximum possible total table stack within every INTEGER-backed
-- completed-hand amount. BIGINT is used only for the multiplication so the
-- constraint itself cannot overflow while validating a Room row.
ALTER TABLE "Room"
  ADD CONSTRAINT "Room_table_points_range_check"
    CHECK ("maximumBuyIn" * "maxSeats"::BIGINT <= 2000000000);
