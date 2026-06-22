-- AlterTable
ALTER TABLE "communities" ADD COLUMN "leaderId" INTEGER;

-- CreateIndex
CREATE INDEX "communities_leaderId_idx" ON "communities"("leaderId");

-- AddForeignKey
ALTER TABLE "communities" ADD CONSTRAINT "communities_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
