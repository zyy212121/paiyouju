ALTER TABLE "Room"
  DROP CONSTRAINT "Room_squid_mode_shape_check",
  ADD CONSTRAINT "Room_squid_mode_shape_check"
    CHECK (
      ("specialMode" IN ('NORMAL', 'SHORT_DECK') AND "squidStake" IS NULL)
      OR
      ("specialMode" = 'SQUID' AND "squidStake" BETWEEN 1 AND 2000000000)
    ),
  ADD CONSTRAINT "Room_short_deck_stack_limits_check"
    CHECK (
      "specialMode" <> 'SHORT_DECK'
      OR (
        "initialBuyIn" = "minimumBuyIn"
        AND "minimumBuyIn" <= "maximumBuyIn"
      )
    );
