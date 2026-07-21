-- CreateEnum
CREATE TYPE "AssetVisibility" AS ENUM ('Public', 'Members');

-- AlterEnum
ALTER TYPE "AssetKind" ADD VALUE 'Avatar';

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "visibility" "AssetVisibility" NOT NULL DEFAULT 'Members';

-- AlterTable
ALTER TABLE "user_ranks" ADD COLUMN     "assetByteLimit" INTEGER NOT NULL DEFAULT 0;

-- Every asset that exists before this migration is a seeded site fixture: the
-- only ingest path so far was assetFixtures. The column defaults to Members
-- (the safe end for uploads, which is what every future row will be), so the
-- pre-existing fixtures are moved to Public here rather than waiting on a
-- re-seed — otherwise theme imagery starts demanding auth on an existing
-- install the moment this migration lands.
UPDATE "assets" SET "visibility" = 'Public' WHERE "ownerId" IS NULL;
