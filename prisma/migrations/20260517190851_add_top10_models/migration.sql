-- CreateEnum
CREATE TYPE "Top10SnapshotType" AS ENUM ('Daily', 'Weekly');

-- CreateTable
CREATE TABLE "release_votes" (
    "id" SERIAL NOT NULL,
    "releaseId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "positive" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "release_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_vote_aggregates" (
    "id" SERIAL NOT NULL,
    "releaseId" INTEGER NOT NULL,
    "ups" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "release_vote_aggregates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "top10_snapshots" (
    "id" SERIAL NOT NULL,
    "type" "Top10SnapshotType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "top10_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "top10_snapshot_entries" (
    "id" SERIAL NOT NULL,
    "snapshotId" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "releaseId" INTEGER,
    "releaseTitle" VARCHAR(255) NOT NULL,
    "tagString" VARCHAR(255) NOT NULL,

    CONSTRAINT "top10_snapshot_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "release_votes_releaseId_idx" ON "release_votes"("releaseId");

-- CreateIndex
CREATE INDEX "release_votes_userId_idx" ON "release_votes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "release_votes_releaseId_userId_key" ON "release_votes"("releaseId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "release_vote_aggregates_releaseId_key" ON "release_vote_aggregates"("releaseId");

-- CreateIndex
CREATE INDEX "release_vote_aggregates_score_idx" ON "release_vote_aggregates"("score");

-- CreateIndex
CREATE INDEX "top10_snapshots_type_createdAt_idx" ON "top10_snapshots"("type", "createdAt");

-- CreateIndex
CREATE INDEX "top10_snapshot_entries_snapshotId_idx" ON "top10_snapshot_entries"("snapshotId");

-- CreateIndex
CREATE INDEX "top10_snapshot_entries_releaseId_idx" ON "top10_snapshot_entries"("releaseId");

-- AddForeignKey
ALTER TABLE "release_votes" ADD CONSTRAINT "release_votes_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_votes" ADD CONSTRAINT "release_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_vote_aggregates" ADD CONSTRAINT "release_vote_aggregates_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "top10_snapshot_entries" ADD CONSTRAINT "top10_snapshot_entries_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "top10_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "top10_snapshot_entries" ADD CONSTRAINT "top10_snapshot_entries_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
