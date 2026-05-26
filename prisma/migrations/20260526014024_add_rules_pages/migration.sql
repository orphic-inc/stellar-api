-- CreateTable
CREATE TABLE "rules_pages" (
    "id" SERIAL NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "authorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rules_pages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rules_pages_slug_key" ON "rules_pages"("slug");

-- CreateIndex
CREATE INDEX "rules_pages_isMain_idx" ON "rules_pages"("isMain");

-- CreateIndex
CREATE INDEX "rules_pages_sortOrder_idx" ON "rules_pages"("sortOrder");

-- AddForeignKey
ALTER TABLE "rules_pages" ADD CONSTRAINT "rules_pages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
