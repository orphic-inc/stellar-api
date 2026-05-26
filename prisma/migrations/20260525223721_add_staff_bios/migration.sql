-- AlterTable
ALTER TABLE "user_ranks" ADD COLUMN     "displayStaff" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "staffGroupId" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "staffBio" VARCHAR(500);

-- CreateTable
CREATE TABLE "staff_groups" (
    "id" SERIAL NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "staff_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_groups_name_key" ON "staff_groups"("name");

-- CreateIndex
CREATE INDEX "staff_groups_sortOrder_idx" ON "staff_groups"("sortOrder");

-- CreateIndex
CREATE INDEX "user_ranks_displayStaff_idx" ON "user_ranks"("displayStaff");

-- CreateIndex
CREATE INDEX "user_ranks_staffGroupId_idx" ON "user_ranks"("staffGroupId");

-- AddForeignKey
ALTER TABLE "user_ranks" ADD CONSTRAINT "user_ranks_staffGroupId_fkey" FOREIGN KEY ("staffGroupId") REFERENCES "staff_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
