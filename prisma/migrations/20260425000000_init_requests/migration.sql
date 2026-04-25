-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('open', 'filled', 'deleted');

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "uploaded" SET DATA TYPE BIGINT,
ALTER COLUMN "downloaded" SET DATA TYPE BIGINT;

-- CreateTable
CREATE TABLE "requests" (
    "id" SERIAL NOT NULL,
    "communityId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" "ReleaseType" NOT NULL,
    "year" INTEGER,
    "image" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'open',
    "fillerId" INTEGER,
    "filledAt" TIMESTAMP(3),
    "filledContributionId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_bounties" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_bounties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_artists" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "artistId" INTEGER NOT NULL,

    CONSTRAINT "request_artists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "economy_transactions" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "contextId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "economy_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "requests_communityId_idx" ON "requests"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "request_bounties_requestId_userId_key" ON "request_bounties"("requestId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "request_artists_requestId_artistId_key" ON "request_artists"("requestId", "artistId");

-- CreateIndex
CREATE INDEX "economy_transactions_userId_idx" ON "economy_transactions"("userId");

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_fillerId_fkey" FOREIGN KEY ("fillerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_filledContributionId_fkey" FOREIGN KEY ("filledContributionId") REFERENCES "contributions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_bounties" ADD CONSTRAINT "request_bounties_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_bounties" ADD CONSTRAINT "request_bounties_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_artists" ADD CONSTRAINT "request_artists_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_artists" ADD CONSTRAINT "request_artists_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "artists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy_transactions" ADD CONSTRAINT "economy_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

