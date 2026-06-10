-- =====================================================================
-- DESTRUCTIVE — Music model CONTRACT (#72). Drops the legacy single-artist
-- / untyped-format columns now that ReleaseArtist + Edition + typed enums
-- (the EXPAND, 20260605185850) are in place.
--
-- ⚠️ REQUIRES BACKFILL FIRST (#73 / #74). On a POPULATED database this will
-- lose data and/or fail: `editionId SET NOT NULL` needs every contribution
-- to already have an Edition, and dropping `releases.artistId` assumes each
-- release's artist has been migrated into ReleaseArtist. Run the
-- expand->backfill data migration before applying this on prod.
-- Safe as-is only on fresh/empty databases (CI, new installs).
-- =====================================================================

-- DropForeignKey
ALTER TABLE "releases" DROP CONSTRAINT "releases_artistId_fkey";

-- DropForeignKey
ALTER TABLE "contributions" DROP CONSTRAINT "contributions_editionId_fkey";

-- DropIndex
DROP INDEX "releases_artistId_idx";

-- AlterTable
ALTER TABLE "releases" DROP COLUMN "artistId",
DROP COLUMN "catalogueNumber",
DROP COLUMN "edition",
DROP COLUMN "isEdition",
DROP COLUMN "recordLabel";

-- AlterTable
ALTER TABLE "contributions" DROP COLUMN "bitrateValue",
DROP COLUMN "media",
DROP COLUMN "bitrate",
ADD COLUMN     "bitrate" "Bitrate",
ALTER COLUMN "editionId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "editions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

