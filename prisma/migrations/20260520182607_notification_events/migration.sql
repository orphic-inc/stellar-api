-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('forum_quote', 'forum_sub', 'request_filled', 'collage_updated', 'comment_sub');

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_quoterId_fkey";

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "actorId" INTEGER,
ADD COLUMN     "type" "NotificationType" NOT NULL DEFAULT 'forum_quote',
ALTER COLUMN "postId" DROP NOT NULL;

-- Backfill legacy quote notifications before removing the old actor column.
UPDATE "notifications"
SET "actorId" = "quoterId"
WHERE "actorId" IS NULL;

-- Drop legacy column after backfill.
ALTER TABLE "notifications" DROP COLUMN "quoterId";

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
