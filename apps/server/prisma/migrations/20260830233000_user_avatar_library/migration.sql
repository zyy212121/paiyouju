ALTER TABLE "User"
  ADD COLUMN "avatarId" VARCHAR(16);

UPDATE "User"
SET "avatarId" = 'avatar-' || LPAD((((GET_BYTE(DECODE(MD5("id"), 'hex'), 0) % 16) + 1)::TEXT), 2, '0');

ALTER TABLE "User"
  ALTER COLUMN "avatarId" SET DEFAULT 'avatar-01',
  ALTER COLUMN "avatarId" SET NOT NULL;

ALTER TABLE "User"
  ADD CONSTRAINT "User_avatarId_check"
  CHECK ("avatarId" IN (
    'avatar-01', 'avatar-02', 'avatar-03', 'avatar-04',
    'avatar-05', 'avatar-06', 'avatar-07', 'avatar-08',
    'avatar-09', 'avatar-10', 'avatar-11', 'avatar-12',
    'avatar-13', 'avatar-14', 'avatar-15', 'avatar-16'
  ));
