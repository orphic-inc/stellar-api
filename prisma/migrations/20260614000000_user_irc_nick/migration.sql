-- AlterTable: add ircNick to User (nullable, unique)
ALTER TABLE "User" ADD COLUMN "ircNick" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_ircNick_key" ON "User"("ircNick");
