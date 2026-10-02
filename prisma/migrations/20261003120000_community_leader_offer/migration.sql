-- #896, ADR-0053 §5–6: a leader's pending handoff offer, and the three
-- notifications it sends. One offer per community; it lapses lazily, so no job
-- reads these columns, and the audit log keeps the history.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'community_leader_offered';
ALTER TYPE "NotificationType" ADD VALUE 'community_leader_accepted';
ALTER TYPE "NotificationType" ADD VALUE 'community_leader_declined';

-- AlterTable
ALTER TABLE "communities" ADD COLUMN "leaderOfferToId" INTEGER,
ADD COLUMN "leaderOfferedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "communities_leaderOfferToId_idx" ON "communities"("leaderOfferToId");

-- AddForeignKey
ALTER TABLE "communities" ADD CONSTRAINT "communities_leaderOfferToId_fkey" FOREIGN KEY ("leaderOfferToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
