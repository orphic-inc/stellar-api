-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('ThemeImage', 'ThemeFont');

-- CreateTable
-- Content-addressed binary asset store (ADR-0026, #290). `hash` is the sha256 of
-- `data` and is the public address the serve route resolves; the unique index is
-- what makes storing identical bytes twice collapse to one row.
CREATE TABLE "assets" (
    "id" SERIAL NOT NULL,
    "hash" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "data" BYTEA NOT NULL,
    "ownerId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assets_hash_key" ON "assets"("hash");

-- CreateIndex
CREATE INDEX "assets_ownerId_idx" ON "assets"("ownerId");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
