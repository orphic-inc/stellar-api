-- CreateTable: collages
CREATE TABLE "collages" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL DEFAULT 1,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "maxEntries" INTEGER NOT NULL DEFAULT 0,
    "maxEntriesPerUser" INTEGER NOT NULL DEFAULT 0,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "numEntries" INTEGER NOT NULL DEFAULT 0,
    "numSubscribers" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "collages_pkey" PRIMARY KEY ("id")
);

-- CreateTable: collage_entries
CREATE TABLE "collage_entries" (
    "id" SERIAL NOT NULL,
    "collageId" INTEGER NOT NULL,
    "releaseId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collage_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable: collage_subscriptions
CREATE TABLE "collage_subscriptions" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "collageId" INTEGER NOT NULL,
    "lastVisit" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collage_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "collages_name_key" ON "collages"("name");
CREATE INDEX "collages_userId_idx" ON "collages"("userId");
CREATE INDEX "collages_categoryId_idx" ON "collages"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "collage_entries_collageId_releaseId_key" ON "collage_entries"("collageId", "releaseId");
CREATE INDEX "collage_entries_collageId_sort_idx" ON "collage_entries"("collageId", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "collage_subscriptions_userId_collageId_key" ON "collage_subscriptions"("userId", "collageId");
CREATE INDEX "collage_subscriptions_collageId_idx" ON "collage_subscriptions"("collageId");

-- AddColumn: collageId to comments
ALTER TABLE "comments" ADD COLUMN "collageId" INTEGER;
CREATE INDEX "comments_page_collageId_idx" ON "comments"("page", "collageId");

-- AddForeignKey: collages
ALTER TABLE "collages" ADD CONSTRAINT "collages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: collage_entries
ALTER TABLE "collage_entries" ADD CONSTRAINT "collage_entries_collageId_fkey" FOREIGN KEY ("collageId") REFERENCES "collages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collage_entries" ADD CONSTRAINT "collage_entries_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collage_entries" ADD CONSTRAINT "collage_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: collage_subscriptions
ALTER TABLE "collage_subscriptions" ADD CONSTRAINT "collage_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "collage_subscriptions" ADD CONSTRAINT "collage_subscriptions_collageId_fkey" FOREIGN KEY ("collageId") REFERENCES "collages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: bookmark_collages
ALTER TABLE "bookmark_collages" ADD CONSTRAINT "bookmark_collages_collageId_fkey" FOREIGN KEY ("collageId") REFERENCES "collages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: comments (collageId)
ALTER TABLE "comments" ADD CONSTRAINT "comments_collageId_fkey" FOREIGN KEY ("collageId") REFERENCES "collages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
