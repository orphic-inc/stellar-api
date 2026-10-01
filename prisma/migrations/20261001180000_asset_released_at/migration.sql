-- #871: when the owner's last image field moved off an asset. A released
-- asset stops counting toward assetLimit; the orphan sweep still deletes it.
-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "releasedAt" TIMESTAMP(3);

