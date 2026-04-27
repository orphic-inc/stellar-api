/*
  Warnings:

  - Added the required column `updatedAt` to the `private_conversations` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "private_conversations" ADD COLUMN     "assignedStaffId" INTEGER,
ADD COLUMN     "isStaffTicket" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ticketStatus" "StaffInboxStatus",
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now();

-- CreateIndex
CREATE INDEX "private_conversations_isStaffTicket_ticketStatus_idx" ON "private_conversations"("isStaffTicket", "ticketStatus");

-- AddForeignKey
ALTER TABLE "private_conversations" ADD CONSTRAINT "private_conversations_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
