-- AlterTable
ALTER TABLE "contributions" ADD COLUMN     "bitrate" TEXT,
ADD COLUMN     "hasCue" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hasLog" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isScene" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "media" TEXT;

-- AlterTable
ALTER TABLE "releases" ADD COLUMN     "catalogueNumber" TEXT,
ADD COLUMN     "recordLabel" TEXT;

-- CreateIndex
CREATE INDEX "releases_year_idx" ON "releases"("year");

-- CreateIndex
CREATE INDEX "releases_createdAt_idx" ON "releases"("createdAt");
