-- #737 (ADR-0051): remote images are imported on write, so no viewer's browser
-- fetches a third-party host.
--
-- `remote_images` holds one row per remote image URL a member referenced: its
-- status, why it failed, and the asset it became. `Imported` is the asset kind
-- those bytes are stored under; it is exempt from the rank `assetLimit`, which
-- governs uploads.
--
-- Additive only. A release that predates this ignores the table, but cannot read
-- an `assets` row of kind `Imported`, so once one exists a rollback past this
-- release needs the pre-deploy backup.
-- CreateEnum
CREATE TYPE "RemoteImageStatus" AS ENUM ('pending', 'imported', 'failed');

-- AlterEnum
ALTER TYPE "AssetKind" ADD VALUE 'Imported';

-- CreateTable
CREATE TABLE "remote_images" (
    "id" SERIAL NOT NULL,
    "url" VARCHAR(2000) NOT NULL,
    "status" "RemoteImageStatus" NOT NULL DEFAULT 'pending',
    "reason" VARCHAR(300),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assetHash" TEXT,
    "requestedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "remote_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "remote_images_url_key" ON "remote_images"("url");

-- CreateIndex
CREATE INDEX "remote_images_status_nextAttemptAt_idx" ON "remote_images"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "remote_images_requestedById_createdAt_idx" ON "remote_images"("requestedById", "createdAt");

-- CreateIndex
CREATE INDEX "remote_images_assetHash_idx" ON "remote_images"("assetHash");

-- AddForeignKey
ALTER TABLE "remote_images" ADD CONSTRAINT "remote_images_assetHash_fkey" FOREIGN KEY ("assetHash") REFERENCES "assets"("hash") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remote_images" ADD CONSTRAINT "remote_images_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

