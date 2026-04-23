-- AlterEnum
ALTER TYPE "CommentPage" ADD VALUE 'release';

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "releaseId" INTEGER;

-- CreateIndex
CREATE INDEX "comments_page_releaseId_idx" ON "comments"("page", "releaseId");

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
