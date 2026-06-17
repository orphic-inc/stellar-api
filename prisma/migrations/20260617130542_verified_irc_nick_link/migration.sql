-- AlterTable
ALTER TABLE "users" ADD COLUMN     "ircNickNonce" TEXT,
ADD COLUMN     "ircNickNonceExpiresAt" TIMESTAMP(3),
ADD COLUMN     "pendingIrcNick" TEXT;
