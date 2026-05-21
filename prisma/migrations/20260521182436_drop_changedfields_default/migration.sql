ALTER TYPE "ReleaseHistoryAction" ADD VALUE IF NOT EXISTS 'created';
ALTER TYPE "ReleaseHistoryAction" ADD VALUE IF NOT EXISTS 'contribution_added';

-- AlterTable
ALTER TABLE "release_histories" ALTER COLUMN "changedFields" DROP DEFAULT;
