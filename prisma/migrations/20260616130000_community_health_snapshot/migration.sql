-- #75: persist the community link-health pulse as a time-series snapshot,
-- mirroring user_stat_snapshots / site_stat_snapshots. Reuses the existing
-- "StatSnapshotPeriod" enum (Daily/Monthly/Yearly).
CREATE TABLE "community_health_snapshots" (
    "id" SERIAL NOT NULL,
    "communityId" INTEGER NOT NULL,
    "period" "StatSnapshotPeriod" NOT NULL,
    "bucketAt" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pass" INTEGER NOT NULL DEFAULT 0,
    "warn" INTEGER NOT NULL DEFAULT 0,
    "fail" INTEGER NOT NULL DEFAULT 0,
    "unknown" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "checked" INTEGER NOT NULL DEFAULT 0,
    "coverage" DOUBLE PRECISION,
    "pulse" DOUBLE PRECISION,
    "status" TEXT NOT NULL,

    CONSTRAINT "community_health_snapshots_pkey" PRIMARY KEY ("id")
);

-- One snapshot per (community, period, bucket); the capture is idempotent.
CREATE UNIQUE INDEX "community_health_snapshots_communityId_period_bucketAt_key" ON "community_health_snapshots"("communityId", "period", "bucketAt");

-- Trend reads: a community's history within a period, oldest-first.
CREATE INDEX "community_health_snapshots_communityId_period_capturedAt_idx" ON "community_health_snapshots"("communityId", "period", "capturedAt");

ALTER TABLE "community_health_snapshots" ADD CONSTRAINT "community_health_snapshots_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
