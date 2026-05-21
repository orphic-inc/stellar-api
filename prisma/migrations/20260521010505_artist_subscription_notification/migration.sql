-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'artist_release';

-- CreateTable
CREATE TABLE "artist_subscriptions" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "artistId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artist_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "artist_subscriptions_artistId_idx" ON "artist_subscriptions"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "artist_subscriptions_userId_artistId_key" ON "artist_subscriptions"("userId", "artistId");

-- AddForeignKey
ALTER TABLE "artist_subscriptions" ADD CONSTRAINT "artist_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artist_subscriptions" ADD CONSTRAINT "artist_subscriptions_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "artists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
