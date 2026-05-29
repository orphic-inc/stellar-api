-- AlterTable
ALTER TABLE "featured_albums" ADD COLUMN     "image" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "user_settings" ALTER COLUMN "notificationMethod" SET DEFAULT 'Traditional';
