-- ReleaseGroup: cross-community content identity (ADR-0023, #265).
--
-- The two ALTER TABLEs below add a NOT NULL column with no default to
-- `cover_art` and `group_logs`, which would fail outright on a table holding
-- rows. Both are safe because both tables are EMPTY BY CONSTRUCTION: they have
-- existed as unreferenced stubs since the initial import, and nothing in the
-- tree has ever written either one -- no route, module, seed, factory or raw
-- query. Verified by whole-tree search before this migration was written.
--
-- `group_logs.communityId` is dropped rather than carried forward: a release
-- group spans communities by definition, so a community-scoped column on its
-- log was a category error.
--
-- `releases.releaseGroupId` is nullable and never backfilled -- groups are
-- created on demand, so an ungrouped release is the normal case. Its foreign
-- key is ON DELETE SET NULL: deleting an identity node detaches its members
-- rather than destroying community-owned content.
-- DropIndex
DROP INDEX "cover_art_groupId_image_key";

-- AlterTable
ALTER TABLE "releases" ADD COLUMN     "releaseGroupId" INTEGER;

-- AlterTable
ALTER TABLE "cover_art" DROP COLUMN "groupId",
ADD COLUMN     "releaseGroupId" INTEGER NOT NULL,
ALTER COLUMN "image" DROP DEFAULT,
ALTER COLUMN "userId" DROP DEFAULT,
ALTER COLUMN "addedAt" SET NOT NULL,
ALTER COLUMN "addedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "group_logs" DROP COLUMN "communityId",
DROP COLUMN "groupId",
ADD COLUMN     "releaseGroupId" INTEGER NOT NULL,
ALTER COLUMN "userId" DROP NOT NULL,
ALTER COLUMN "userId" DROP DEFAULT,
ALTER COLUMN "info" SET NOT NULL,
ALTER COLUMN "loggedAt" SET DEFAULT CURRENT_TIMESTAMP,
DROP COLUMN "hidden",
ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "release_groups" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "artistId" INTEGER,
    "year" INTEGER,
    "identityKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "release_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "release_groups_identityKey_key" ON "release_groups"("identityKey");

-- CreateIndex
CREATE INDEX "release_groups_artistId_idx" ON "release_groups"("artistId");

-- CreateIndex
CREATE INDEX "releases_releaseGroupId_idx" ON "releases"("releaseGroupId");

-- CreateIndex
CREATE INDEX "cover_art_userId_idx" ON "cover_art"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "cover_art_releaseGroupId_image_key" ON "cover_art"("releaseGroupId", "image");

-- CreateIndex
CREATE INDEX "group_logs_releaseGroupId_loggedAt_idx" ON "group_logs"("releaseGroupId", "loggedAt");

-- CreateIndex
CREATE INDEX "group_logs_userId_idx" ON "group_logs"("userId");

-- AddForeignKey
ALTER TABLE "release_groups" ADD CONSTRAINT "release_groups_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "artists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cover_art" ADD CONSTRAINT "cover_art_releaseGroupId_fkey" FOREIGN KEY ("releaseGroupId") REFERENCES "release_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cover_art" ADD CONSTRAINT "cover_art_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_logs" ADD CONSTRAINT "group_logs_releaseGroupId_fkey" FOREIGN KEY ("releaseGroupId") REFERENCES "release_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_logs" ADD CONSTRAINT "group_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "releases" ADD CONSTRAINT "releases_releaseGroupId_fkey" FOREIGN KEY ("releaseGroupId") REFERENCES "release_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

