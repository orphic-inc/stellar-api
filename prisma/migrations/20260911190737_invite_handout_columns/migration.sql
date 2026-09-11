-- AlterTable
ALTER TABLE "user_ranks" ADD COLUMN     "inviteCap" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "inviteGrantPerPeriod" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lastInviteGrantAt" TIMESTAMP(3);
