/*
  Warnings:

  - You are about to drop the column `bitrate` on the `contributions` table. All the data in the column will be lost.
  - You are about to drop the column `hasCue` on the `contributions` table. All the data in the column will be lost.
  - You are about to drop the column `hasLog` on the `contributions` table. All the data in the column will be lost.
  - You are about to drop the column `isScene` on the `contributions` table. All the data in the column will be lost.
  - You are about to drop the column `media` on the `contributions` table. All the data in the column will be lost.
  - You are about to drop the column `artistId` on the `releases` table. All the data in the column will be lost.
  - You are about to drop the column `catalogueNumber` on the `releases` table. All the data in the column will be lost.
  - You are about to drop the column `edition` on the `releases` table. All the data in the column will be lost.
  - You are about to drop the column `isEdition` on the `releases` table. All the data in the column will be lost.
  - You are about to drop the column `recordLabel` on the `releases` table. All the data in the column will be lost.
  - Added the required column `editionId` to the `contributions` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ArtistRole" AS ENUM ('Main', 'Guest', 'Composer', 'Conductor', 'DJ', 'Remixer', 'Producer', 'Arranger');

-- CreateEnum
CREATE TYPE "Bitrate" AS ENUM ('Lossless', 'Lossless24', 'Kbps320', 'Kbps256', 'KbpsV0', 'Kbps192', 'KbpsV2', 'Kbps128', 'Other');

-- CreateEnum
CREATE TYPE "ReleaseMedia" AS ENUM ('CD', 'WEB', 'Vinyl', 'SACD', 'DVD', 'Cassette', 'BluRay', 'DAT', 'Soundboard', 'Other');

-- DropForeignKey
ALTER TABLE "releases" DROP CONSTRAINT "releases_artistId_fkey";

-- DropIndex
DROP INDEX "releases_artistId_idx";

-- AlterTable
ALTER TABLE "_CommunityConsumers" ADD CONSTRAINT "_CommunityConsumers_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_CommunityConsumers_AB_unique";

-- AlterTable
ALTER TABLE "_CommunityStaff" ADD CONSTRAINT "_CommunityStaff_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_CommunityStaff_AB_unique";

-- AlterTable
ALTER TABLE "_ContributionCollaborators" ADD CONSTRAINT "_ContributionCollaborators_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_ContributionCollaborators_AB_unique";

-- AlterTable
ALTER TABLE "_ContributionConsumers" ADD CONSTRAINT "_ContributionConsumers_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_ContributionConsumers_AB_unique";

-- AlterTable
ALTER TABLE "_ReleaseConsumers" ADD CONSTRAINT "_ReleaseConsumers_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_ReleaseConsumers_AB_unique";

-- AlterTable
ALTER TABLE "_ReleaseContributors" ADD CONSTRAINT "_ReleaseContributors_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_ReleaseContributors_AB_unique";

-- AlterTable
ALTER TABLE "contributions" DROP COLUMN "bitrate",
DROP COLUMN "hasCue",
DROP COLUMN "hasLog",
DROP COLUMN "isScene",
DROP COLUMN "media",
ADD COLUMN     "editionId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "releases" DROP COLUMN "artistId",
DROP COLUMN "catalogueNumber",
DROP COLUMN "edition",
DROP COLUMN "isEdition",
DROP COLUMN "recordLabel";

-- CreateTable
CREATE TABLE "release_files" (
    "id" SERIAL NOT NULL,
    "contributionId" INTEGER NOT NULL,
    "bitrate" "Bitrate",
    "hasLog" BOOLEAN NOT NULL DEFAULT false,
    "hasCue" BOOLEAN NOT NULL DEFAULT false,
    "isScene" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "release_files_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX "release_files_contributionId_key" ON "release_files"("contributionId");

-- CreateIndex
CREATE INDEX "release_artists_artistId_idx" ON "release_artists"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "release_artists_releaseId_artistId_role_key" ON "release_artists"("releaseId", "artistId", "role");

-- CreateIndex
CREATE INDEX "editions_releaseId_idx" ON "editions"("releaseId");

-- CreateIndex
CREATE INDEX "contributions_editionId_idx" ON "contributions"("editionId");

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "editions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_files" ADD CONSTRAINT "release_files_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "contributions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_artists" ADD CONSTRAINT "release_artists_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_artists" ADD CONSTRAINT "release_artists_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "artists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editions" ADD CONSTRAINT "editions_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
