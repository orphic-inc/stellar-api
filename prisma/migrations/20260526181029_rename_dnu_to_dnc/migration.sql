/*
  Warnings:

  - You are about to drop the `do_not_upload` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "do_not_upload" DROP CONSTRAINT "do_not_upload_communityId_fkey";

-- DropTable
DROP TABLE "do_not_upload";

-- CreateTable
CREATE TABLE "do_not_contribute" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "communityId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "do_not_contribute_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "do_not_contribute" ADD CONSTRAINT "do_not_contribute_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
