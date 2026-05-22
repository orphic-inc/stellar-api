-- CreateEnum
CREATE TYPE "StatSnapshotPeriod" AS ENUM ('Daily', 'Monthly', 'Yearly');

-- CreateTable
CREATE TABLE "user_stat_snapshots" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "period" "StatSnapshotPeriod" NOT NULL,
    "bucketAt" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contributed" BIGINT NOT NULL DEFAULT 0,
    "consumed" BIGINT NOT NULL DEFAULT 0,
    "contributionCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_stat_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_stat_snapshots" (
    "id" SERIAL NOT NULL,
    "bucketAt" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "maxUsers" INTEGER NOT NULL DEFAULT 0,
    "totalUsers" INTEGER NOT NULL DEFAULT 0,
    "enabledUsers" INTEGER NOT NULL DEFAULT 0,
    "activeToday" INTEGER NOT NULL DEFAULT 0,
    "activeThisWeek" INTEGER NOT NULL DEFAULT 0,
    "activeThisMonth" INTEGER NOT NULL DEFAULT 0,
    "communities" INTEGER NOT NULL DEFAULT 0,
    "releases" INTEGER NOT NULL DEFAULT 0,
    "artists" INTEGER NOT NULL DEFAULT 0,
    "blogPosts" INTEGER NOT NULL DEFAULT 0,
    "announcements" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "contributedLinks" INTEGER NOT NULL DEFAULT 0,
    "contributedLinkDownloads" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "site_stat_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_stat_snapshots_userId_period_capturedAt_idx" ON "user_stat_snapshots"("userId", "period", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_stat_snapshots_userId_period_bucketAt_key" ON "user_stat_snapshots"("userId", "period", "bucketAt");

-- CreateIndex
CREATE UNIQUE INDEX "site_stat_snapshots_bucketAt_key" ON "site_stat_snapshots"("bucketAt");

-- CreateIndex
CREATE INDEX "site_stat_snapshots_capturedAt_idx" ON "site_stat_snapshots"("capturedAt");

-- AddForeignKey
ALTER TABLE "user_stat_snapshots" ADD CONSTRAINT "user_stat_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
