/*
  Warnings:

  - You are about to drop the `friends` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "FriendStatus" AS ENUM ('pending', 'accepted', 'rejected');

-- DropForeignKey
ALTER TABLE "friends" DROP CONSTRAINT "friends_friendId_fkey";

-- DropForeignKey
ALTER TABLE "friends" DROP CONSTRAINT "friends_userId_fkey";

-- DropTable
DROP TABLE "friends";

-- CreateTable
CREATE TABLE "friend_relationships" (
    "id" SERIAL NOT NULL,
    "requesterId" INTEGER NOT NULL,
    "recipientId" INTEGER NOT NULL,
    "status" "FriendStatus" NOT NULL DEFAULT 'pending',
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "friend_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "friend_relationships_recipientId_status_idx" ON "friend_relationships"("recipientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "friend_relationships_requesterId_recipientId_key" ON "friend_relationships"("requesterId", "recipientId");

-- AddForeignKey
ALTER TABLE "friend_relationships" ADD CONSTRAINT "friend_relationships_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friend_relationships" ADD CONSTRAINT "friend_relationships_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
