/*
  Warnings:

  - You are about to drop the column `assignedStaffId` on the `private_conversations` table. All the data in the column will be lost.
  - You are about to drop the column `isStaffTicket` on the `private_conversations` table. All the data in the column will be lost.
  - You are about to drop the column `ticketStatus` on the `private_conversations` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "private_conversations" DROP CONSTRAINT "private_conversations_assignedStaffId_fkey";

-- DropIndex
DROP INDEX "private_conversations_isStaffTicket_ticketStatus_idx";

-- AlterTable
ALTER TABLE "private_conversations" DROP COLUMN "assignedStaffId",
DROP COLUMN "isStaffTicket",
DROP COLUMN "ticketStatus",
ALTER COLUMN "updatedAt" DROP DEFAULT;
