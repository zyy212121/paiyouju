ALTER TABLE "HandRecord"
ADD COLUMN "fullBoard" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "HandRecord"
SET "fullBoard" = CASE
  WHEN cardinality("board") = 5 THEN "board"
  WHEN cardinality("remainingDeck") >= 5 - cardinality("board")
    THEN "board" || "remainingDeck"[1:(5 - cardinality("board"))]
  ELSE ARRAY[]::TEXT[]
END;

ALTER TABLE "HandRecord"
ADD CONSTRAINT "HandRecord_fullBoard_length_check"
CHECK (cardinality("fullBoard") IN (0, 5));
