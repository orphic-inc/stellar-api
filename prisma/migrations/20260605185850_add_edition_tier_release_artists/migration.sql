-- CreateEnum
CREATE TYPE "ArtistRole" AS ENUM ('Main', 'Guest', 'Composer', 'Conductor', 'DJ', 'Remixer', 'Producer', 'Arranger');

-- CreateEnum
CREATE TYPE "Bitrate" AS ENUM ('Lossless', 'Lossless24', 'Kbps320', 'Kbps256', 'KbpsV0', 'Kbps192', 'KbpsV2', 'Kbps128', 'Other');

-- CreateEnum
CREATE TYPE "ReleaseMedia" AS ENUM ('CD', 'WEB', 'Vinyl', 'SACD', 'DVD', 'Cassette', 'BluRay', 'DAT', 'Soundboard', 'Other');

-- AlterTable
ALTER TABLE "contributions" ADD COLUMN     "bitrateValue" "Bitrate",
ADD COLUMN     "editionId" INTEGER;

-- CreateTable
CREATE TABLE "release_artists" (
    "id" SERIAL NOT NULL,
    "releaseId" INTEGER NOT NULL,
    "artistId" INTEGER NOT NULL,
    "role" "ArtistRole" NOT NULL DEFAULT 'Main',

    CONSTRAINT "release_artists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editions" (
    "id" SERIAL NOT NULL,
    "releaseId" INTEGER NOT NULL,
    "title" TEXT,
    "year" INTEGER,
    "recordLabel" TEXT,
    "catalogueNumber" TEXT,
    "media" "ReleaseMedia",
    "isRemaster" BOOLEAN NOT NULL DEFAULT false,
    "isUnknownEdition" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "editions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "release_artists_artistId_idx" ON "release_artists"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "release_artists_releaseId_artistId_role_key" ON "release_artists"("releaseId", "artistId", "role");

-- CreateIndex
CREATE INDEX "editions_releaseId_idx" ON "editions"("releaseId");

-- CreateIndex
CREATE INDEX "contributions_editionId_idx" ON "contributions"("editionId");

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "editions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_artists" ADD CONSTRAINT "release_artists_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_artists" ADD CONSTRAINT "release_artists_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "artists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editions" ADD CONSTRAINT "editions_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
