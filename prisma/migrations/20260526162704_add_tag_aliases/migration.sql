-- CreateTable
CREATE TABLE "tag_aliases" (
    "id" SERIAL NOT NULL,
    "badTag" TEXT NOT NULL,
    "goodTagId" INTEGER NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tag_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tag_aliases_badTag_key" ON "tag_aliases"("badTag");

-- CreateIndex
CREATE INDEX "tag_aliases_goodTagId_idx" ON "tag_aliases"("goodTagId");

-- AddForeignKey
ALTER TABLE "tag_aliases" ADD CONSTRAINT "tag_aliases_goodTagId_fkey" FOREIGN KEY ("goodTagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_aliases" ADD CONSTRAINT "tag_aliases_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
