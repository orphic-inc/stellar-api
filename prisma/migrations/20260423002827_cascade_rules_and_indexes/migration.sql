/*
  Warnings:

  - You are about to drop the column `releaseId` on the `bookmark_communities` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[userId,communityId]` on the table `bookmark_communities` will be added. If there are existing duplicate values, this will fail.
  - Made the column `communityId` on table `bookmark_communities` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `targetType` to the `forum_specific_rules` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ForumRuleTarget" AS ENUM ('Forum', 'Thread', 'Topic');

-- DropForeignKey
ALTER TABLE "bookmark_communities" DROP CONSTRAINT "bookmark_communities_communityId_fkey";

-- DropForeignKey
ALTER TABLE "bookmark_communities" DROP CONSTRAINT "bookmark_communities_releaseId_fkey";

-- DropIndex
DROP INDEX "bookmark_communities_userId_releaseId_key";

-- AlterTable
ALTER TABLE "bookmark_communities" DROP COLUMN "releaseId",
ALTER COLUMN "communityId" SET NOT NULL;

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "forum_posts" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "forum_specific_rules" ADD COLUMN     "targetType" "ForumRuleTarget" NOT NULL;

-- AlterTable
ALTER TABLE "forum_topics" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "bookmark_releases" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "releaseId" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmark_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookmark_releases_userId_releaseId_key" ON "bookmark_releases"("userId", "releaseId");

-- CreateIndex
CREATE UNIQUE INDEX "bookmark_communities_userId_communityId_key" ON "bookmark_communities"("userId", "communityId");

-- AddForeignKey
ALTER TABLE "bookmark_releases" ADD CONSTRAINT "bookmark_releases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmark_releases" ADD CONSTRAINT "bookmark_releases_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmark_communities" ADD CONSTRAINT "bookmark_communities_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
