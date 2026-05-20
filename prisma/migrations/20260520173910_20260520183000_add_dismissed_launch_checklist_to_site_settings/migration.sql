ALTER TABLE "site_settings"
ADD COLUMN "dismissedLaunchChecklist" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
