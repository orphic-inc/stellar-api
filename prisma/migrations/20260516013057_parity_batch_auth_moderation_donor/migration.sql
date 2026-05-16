-- CreateEnum
CREATE TYPE "NotificationMethod" AS ENUM ('Disabled', 'Popup', 'Traditional', 'Push', 'Combined');

-- AlterTable
ALTER TABLE "private_conversations" ADD COLUMN     "assignedStaffId" INTEGER,
ADD COLUMN     "isStaffTicket" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ticketStatus" "StaffInboxStatus";

-- AlterTable
ALTER TABLE "requests" ADD COLUMN     "voteCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "notificationMethod" "NotificationMethod" NOT NULL DEFAULT 'Popup';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lastIp" TEXT;

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_recoveries" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_recoveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_email_histories" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "oldEmail" TEXT NOT NULL,
    "newEmail" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,

    CONSTRAINT "user_email_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_warnings" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "warnedById" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_warnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_moderation_notes" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_moderation_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donor_ranks" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "minDonation" DOUBLE PRECISION NOT NULL,
    "expiresAfterDays" INTEGER,
    "perks" JSONB NOT NULL DEFAULT '{}',
    "color" TEXT NOT NULL DEFAULT '',
    "badge" TEXT NOT NULL DEFAULT '♥',

    CONSTRAINT "donor_ranks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_donor_ranks" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "donorRankId" INTEGER NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "grantedById" INTEGER,

    CONSTRAINT "user_donor_ranks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_votes" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_drafts" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "toUserId" INTEGER,
    "subject" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pm_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mass_messages" (
    "id" SERIAL NOT NULL,
    "senderId" INTEGER NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mass_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_history" (
    "id" SERIAL NOT NULL,
    "authorId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_sessions_userId_idx" ON "user_sessions"("userId");

-- CreateIndex
CREATE INDEX "user_sessions_revokedAt_idx" ON "user_sessions"("revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "account_recoveries_token_key" ON "account_recoveries"("token");

-- CreateIndex
CREATE INDEX "account_recoveries_userId_idx" ON "account_recoveries"("userId");

-- CreateIndex
CREATE INDEX "user_email_histories_userId_idx" ON "user_email_histories"("userId");

-- CreateIndex
CREATE INDEX "user_warnings_userId_idx" ON "user_warnings"("userId");

-- CreateIndex
CREATE INDEX "user_moderation_notes_userId_idx" ON "user_moderation_notes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "donor_ranks_name_key" ON "donor_ranks"("name");

-- CreateIndex
CREATE UNIQUE INDEX "user_donor_ranks_userId_key" ON "user_donor_ranks"("userId");

-- CreateIndex
CREATE INDEX "request_votes_requestId_idx" ON "request_votes"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "request_votes_requestId_userId_key" ON "request_votes"("requestId", "userId");

-- CreateIndex
CREATE INDEX "pm_drafts_userId_idx" ON "pm_drafts"("userId");

-- CreateIndex
CREATE INDEX "private_conversations_isStaffTicket_ticketStatus_idx" ON "private_conversations"("isStaffTicket", "ticketStatus");

-- AddForeignKey
ALTER TABLE "bookmark_requests" ADD CONSTRAINT "bookmark_requests_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "private_conversations" ADD CONSTRAINT "private_conversations_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_recoveries" ADD CONSTRAINT "account_recoveries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_email_histories" ADD CONSTRAINT "user_email_histories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_warnings" ADD CONSTRAINT "user_warnings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_warnings" ADD CONSTRAINT "user_warnings_warnedById_fkey" FOREIGN KEY ("warnedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_moderation_notes" ADD CONSTRAINT "user_moderation_notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_moderation_notes" ADD CONSTRAINT "user_moderation_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_donor_ranks" ADD CONSTRAINT "user_donor_ranks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_donor_ranks" ADD CONSTRAINT "user_donor_ranks_donorRankId_fkey" FOREIGN KEY ("donorRankId") REFERENCES "donor_ranks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_votes" ADD CONSTRAINT "request_votes_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_votes" ADD CONSTRAINT "request_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_drafts" ADD CONSTRAINT "pm_drafts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mass_messages" ADD CONSTRAINT "mass_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_history" ADD CONSTRAINT "site_history_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
