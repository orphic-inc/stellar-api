-- #721: artist credits can be added, removed and re-roled on an existing release.
--
-- `addedById` records who attached each credit, so a credit's adder can undo
-- their own mistake and #722 can rank members by credits attached. Nullable:
-- rows that predate this migration stay null until #722 backfills them from
-- each release's `created` history row.
--
-- Three history actions, one per operation. None is revertable: `revert`
-- accepts only `edit` rows, and credits are not part of the release snapshot.

-- AlterEnum
ALTER TYPE "ReleaseHistoryAction" ADD VALUE 'credit_added';
ALTER TYPE "ReleaseHistoryAction" ADD VALUE 'credit_removed';
ALTER TYPE "ReleaseHistoryAction" ADD VALUE 'credit_role_changed';

-- AlterTable
ALTER TABLE "release_artists" ADD COLUMN     "addedById" INTEGER;

-- CreateIndex
CREATE INDEX "release_artists_addedById_idx" ON "release_artists"("addedById");

-- AddForeignKey
ALTER TABLE "release_artists" ADD CONSTRAINT "release_artists_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

