-- AlterTable
ALTER TABLE "user_ranks" ADD COLUMN     "notificationFilterLimit" INTEGER DEFAULT 0;

-- CreateTable
CREATE TABLE "notification_filters" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "artistIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "communityIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "releaseTypes" "ReleaseType"[] DEFAULT ARRAY[]::"ReleaseType"[],
    "releaseCategories" "ReleaseCategory"[] DEFAULT ARRAY[]::"ReleaseCategory"[],
    "fileTypes" "FileType"[] DEFAULT ARRAY[]::"FileType"[],
    "bitrates" "Bitrate"[] DEFAULT ARRAY[]::"Bitrate"[],
    "media" "ReleaseMedia"[] DEFAULT ARRAY[]::"ReleaseMedia"[],
    "fromYear" INTEGER,
    "toYear" INTEGER,
    "newReleasesOnly" BOOLEAN NOT NULL DEFAULT false,
    "excludeCompilations" BOOLEAN NOT NULL DEFAULT false,
    "mainCreditsOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_filters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_filter_hits" (
    "id" SERIAL NOT NULL,
    "filterId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "contributionId" INTEGER NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_filter_hits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_filters_userId_idx" ON "notification_filters"("userId");

-- CreateIndex
CREATE INDEX "notification_filter_hits_userId_readAt_idx" ON "notification_filter_hits"("userId", "readAt");

-- CreateIndex
CREATE INDEX "notification_filter_hits_contributionId_idx" ON "notification_filter_hits"("contributionId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_filter_hits_filterId_contributionId_key" ON "notification_filter_hits"("filterId", "contributionId");

-- AddForeignKey
ALTER TABLE "notification_filters" ADD CONSTRAINT "notification_filters_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_filter_hits" ADD CONSTRAINT "notification_filter_hits_filterId_fkey" FOREIGN KEY ("filterId") REFERENCES "notification_filters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_filter_hits" ADD CONSTRAINT "notification_filter_hits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_filter_hits" ADD CONSTRAINT "notification_filter_hits_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "contributions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

