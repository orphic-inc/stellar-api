/*
  Warnings:

  - You are about to drop the `contest_leaderboards` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
ALTER TYPE "ReportResolutionAction" ADD VALUE 'MarkedDuplicate';

-- AlterEnum
ALTER TYPE "ReportTargetType" ADD VALUE 'Contribution';

-- DropTable
DROP TABLE "contest_leaderboards";

-- CreateTable
CREATE TABLE "top_ten_leaderboards" (
    "id" SERIAL NOT NULL,
    "contestId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "flacCount" INTEGER NOT NULL,
    "lastTorrentId" INTEGER NOT NULL,
    "lastTorrentName" TEXT NOT NULL,
    "artistList" TEXT NOT NULL,
    "artistNames" TEXT NOT NULL,
    "lastUpload" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "top_ten_leaderboards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "top_ten_leaderboards_flacCount_idx" ON "top_ten_leaderboards"("flacCount");

-- CreateIndex
CREATE INDEX "top_ten_leaderboards_lastUpload_idx" ON "top_ten_leaderboards"("lastUpload");

-- CreateIndex
CREATE INDEX "top_ten_leaderboards_userId_idx" ON "top_ten_leaderboards"("userId");
