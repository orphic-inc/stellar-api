-- AlterTable
ALTER TABLE "private_conversations" DROP COLUMN IF EXISTS "is_staff_ticket",
                                     DROP COLUMN IF EXISTS "ticket_status",
                                     DROP COLUMN IF EXISTS "assigned_staff_id";

-- DropIndex
DROP INDEX IF EXISTS "private_conversations_is_staff_ticket_ticket_status_idx";
