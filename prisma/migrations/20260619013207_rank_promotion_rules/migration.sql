-- CreateEnum
CREATE TYPE "RankExtraPredicate" AS ENUM ('DISTINCT_RELEASES_500', 'QUALITY_CONTRIB_500');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'rank_promoted';
ALTER TYPE "NotificationType" ADD VALUE 'rank_demoted';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "rankLocked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "rank_promotion_rules" (
    "id" SERIAL NOT NULL,
    "fromRankId" INTEGER NOT NULL,
    "toRankId" INTEGER NOT NULL,
    "minContributed" BIGINT NOT NULL DEFAULT 0,
    "minRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minContributions" INTEGER NOT NULL DEFAULT 0,
    "minAccountAgeDays" INTEGER NOT NULL DEFAULT 0,
    "extra" "RankExtraPredicate",
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rank_promotion_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rank_promotion_rules_fromRankId_idx" ON "rank_promotion_rules"("fromRankId");

-- CreateIndex
CREATE INDEX "rank_promotion_rules_toRankId_idx" ON "rank_promotion_rules"("toRankId");

-- CreateIndex
CREATE UNIQUE INDEX "rank_promotion_rules_fromRankId_toRankId_key" ON "rank_promotion_rules"("fromRankId", "toRankId");

-- AddForeignKey
ALTER TABLE "rank_promotion_rules" ADD CONSTRAINT "rank_promotion_rules_fromRankId_fkey" FOREIGN KEY ("fromRankId") REFERENCES "user_ranks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rank_promotion_rules" ADD CONSTRAINT "rank_promotion_rules_toRankId_fkey" FOREIGN KEY ("toRankId") REFERENCES "user_ranks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
