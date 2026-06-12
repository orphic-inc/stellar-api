-- CreateTable
CREATE TABLE "author_stylesheets" (
    "id" SERIAL NOT NULL,
    "authorId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "author_stylesheets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "author_stylesheets_authorId_idx" ON "author_stylesheets"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "author_stylesheets_authorId_name_key" ON "author_stylesheets"("authorId", "name");

-- AddForeignKey
ALTER TABLE "author_stylesheets" ADD CONSTRAINT "author_stylesheets_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

