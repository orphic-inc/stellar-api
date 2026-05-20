/*
  Warnings:

  - You are about to drop the column `quoterId` on the `notifications` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('forum_quote', 'forum_sub', 'request_filled', 'collage_updated', 'comment_sub');

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_quoterId_fkey";

-- AlterTable
ALTER TABLE "notifications" DROP COLUMN "quoterId",
ADD COLUMN     "actorId" INTEGER,
ADD COLUMN     "type" "NotificationType" NOT NULL DEFAULT 'forum_quote',
ALTER COLUMN "postId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
