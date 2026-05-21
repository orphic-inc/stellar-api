-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN "dismissedLaunchChecklist" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "site_settings" ALTER COLUMN "dismissedLaunchChecklist" DROP DEFAULT;
