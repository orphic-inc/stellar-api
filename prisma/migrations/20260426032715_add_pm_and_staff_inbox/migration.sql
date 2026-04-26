/*
  Warnings:

  - The values [wmv,lua] on the enum `FileType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `jsonFile` on the `contributions` table. All the data in the column will be lost.
  - Added the required column `downloadUrl` to the `contributions` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "StaffInboxStatus" AS ENUM ('Unanswered', 'Open', 'Resolved');

-- AlterEnum
BEGIN;
CREATE TYPE "FileType_new" AS ENUM ('mp3', 'flac', 'wav', 'ogg', 'aac', 'm4a', 'm4b', 'mp4', 'mkv', 'avi', 'mov', 'zip', 'exe', 'dmg', 'apk', 'pdf', 'epub', 'mobi', 'cbz', 'cbr', 'jpg', 'png', 'gif', 'txt');
ALTER TABLE "contributions" ALTER COLUMN "type" TYPE "FileType_new" USING ("type"::text::"FileType_new");
ALTER TYPE "FileType" RENAME TO "FileType_old";
ALTER TYPE "FileType_new" RENAME TO "FileType";
DROP TYPE "FileType_old";
COMMIT;

-- AlterTable
ALTER TABLE "collages" ALTER COLUMN "tags" DROP DEFAULT;

-- AlterTable
ALTER TABLE "contributions" DROP COLUMN "jsonFile",
ADD COLUMN     "downloadUrl" TEXT NOT NULL,
ALTER COLUMN "sizeInBytes" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "disablePm" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "private_conversations" (
    "id" SERIAL NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "private_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "private_conversation_participants" (
    "userId" INTEGER NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "inInbox" BOOLEAN NOT NULL DEFAULT true,
    "inSentbox" BOOLEAN NOT NULL DEFAULT false,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isSticky" BOOLEAN NOT NULL DEFAULT false,
    "forwardedToId" INTEGER,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),

    CONSTRAINT "private_conversation_participants_pkey" PRIMARY KEY ("userId","conversationId")
);

-- CreateTable
CREATE TABLE "private_messages" (
    "id" SERIAL NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "senderId" INTEGER,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "private_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_inbox_conversations" (
    "id" SERIAL NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "StaffInboxStatus" NOT NULL DEFAULT 'Unanswered',
    "assignedUserId" INTEGER,
    "resolverId" INTEGER,
    "isReadByUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_inbox_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_inbox_messages" (
    "id" SERIAL NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "senderId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_inbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_inbox_responses" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_inbox_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "private_conversation_participants_userId_idx" ON "private_conversation_participants"("userId");

-- CreateIndex
CREATE INDEX "private_conversation_participants_conversationId_idx" ON "private_conversation_participants"("conversationId");

-- CreateIndex
CREATE INDEX "private_messages_conversationId_idx" ON "private_messages"("conversationId");

-- CreateIndex
CREATE INDEX "staff_inbox_conversations_userId_idx" ON "staff_inbox_conversations"("userId");

-- CreateIndex
CREATE INDEX "staff_inbox_conversations_status_idx" ON "staff_inbox_conversations"("status");

-- CreateIndex
CREATE INDEX "staff_inbox_conversations_assignedUserId_idx" ON "staff_inbox_conversations"("assignedUserId");

-- CreateIndex
CREATE INDEX "staff_inbox_messages_conversationId_idx" ON "staff_inbox_messages"("conversationId");

-- CreateIndex
CREATE INDEX "requests_status_idx" ON "requests"("status");

-- AddForeignKey
ALTER TABLE "private_conversation_participants" ADD CONSTRAINT "private_conversation_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "private_conversation_participants" ADD CONSTRAINT "private_conversation_participants_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "private_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "private_messages" ADD CONSTRAINT "private_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "private_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "private_messages" ADD CONSTRAINT "private_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_inbox_conversations" ADD CONSTRAINT "staff_inbox_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_inbox_conversations" ADD CONSTRAINT "staff_inbox_conversations_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_inbox_conversations" ADD CONSTRAINT "staff_inbox_conversations_resolverId_fkey" FOREIGN KEY ("resolverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_inbox_messages" ADD CONSTRAINT "staff_inbox_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "staff_inbox_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_inbox_messages" ADD CONSTRAINT "staff_inbox_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
