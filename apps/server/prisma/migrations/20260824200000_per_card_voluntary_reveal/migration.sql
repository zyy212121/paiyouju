ALTER TABLE "HandPlayerRecord"
  ADD COLUMN "voluntarilyRevealedCardIndices" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

UPDATE "HandPlayerRecord"
SET "voluntarilyRevealedCardIndices" = ARRAY[0, 1]::INTEGER[]
WHERE "holeCardsPublicReason" = 'VOLUNTARY';

ALTER TABLE "HandPlayerRecord"
  DROP CONSTRAINT "HandPlayerRecord_public_reason_check";

ALTER TABLE "HandPlayerRecord"
  ADD CONSTRAINT "HandPlayerRecord_public_reason_check"
    CHECK (
      (
        "holeCardsPublic" = false
        AND "holeCardsPublicReason" IS NULL
        AND "voluntarilyRevealedAt" IS NULL
        AND cardinality("voluntarilyRevealedCardIndices") = 0
      )
      OR
      (
        "holeCardsPublic" = true
        AND "holeCardsPublicReason" = 'SHOWDOWN'
        AND "voluntarilyRevealedAt" IS NULL
        AND cardinality("voluntarilyRevealedCardIndices") = 0
      )
      OR
      (
        "holeCardsPublicReason" = 'VOLUNTARY'
        AND "voluntarilyRevealedAt" IS NOT NULL
        AND cardinality("voluntarilyRevealedCardIndices") BETWEEN 1 AND 2
        AND "voluntarilyRevealedCardIndices" <@ ARRAY[0, 1]::INTEGER[]
        AND (
          cardinality("voluntarilyRevealedCardIndices") = 1
          OR "voluntarilyRevealedCardIndices"[1] <> "voluntarilyRevealedCardIndices"[2]
        )
        AND "holeCardsPublic" = (cardinality("voluntarilyRevealedCardIndices") = 2)
      )
    );
