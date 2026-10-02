-- #881: personalCollageLimit and authorStylesheetLimit read `0` as none and
-- `null` as unlimited, like assetLimit. Each value the old reading treated as
-- unlimited (`0`, and any stray negative) becomes `null`, so no rank changes
-- behaviour.
-- AlterTable
ALTER TABLE "user_ranks" ALTER COLUMN "personalCollageLimit" DROP NOT NULL,
ALTER COLUMN "authorStylesheetLimit" DROP NOT NULL;

UPDATE "user_ranks" SET "personalCollageLimit" = NULL WHERE "personalCollageLimit" <= 0;
UPDATE "user_ranks" SET "authorStylesheetLimit" = NULL WHERE "authorStylesheetLimit" <= 0;
