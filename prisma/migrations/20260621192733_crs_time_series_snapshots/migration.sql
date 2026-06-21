-- CreateTable
CREATE TABLE "crs_snapshots" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "period" "StatSnapshotPeriod" NOT NULL,
    "bucketAt" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" DOUBLE PRECISION NOT NULL,
    "dimensions" JSONB NOT NULL,

    CONSTRAINT "crs_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crs_snapshots_userId_period_capturedAt_idx" ON "crs_snapshots"("userId", "period", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "crs_snapshots_userId_period_bucketAt_key" ON "crs_snapshots"("userId", "period", "bucketAt");

-- AddForeignKey
ALTER TABLE "crs_snapshots" ADD CONSTRAINT "crs_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
