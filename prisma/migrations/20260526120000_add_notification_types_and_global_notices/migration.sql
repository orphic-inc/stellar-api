-- AlterEnum: SubscriptionPage
ALTER TYPE "SubscriptionPage" ADD VALUE 'news';
ALTER TYPE "SubscriptionPage" ADD VALUE 'global_notices';

-- AlterEnum: NotificationType
ALTER TYPE "NotificationType" ADD VALUE 'site_news';
ALTER TYPE "NotificationType" ADD VALUE 'global_notice';

-- CreateTable
CREATE TABLE "global_notices" (
    "id" SERIAL NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "url" TEXT,
    "createdById" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "global_notices_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "global_notices" ADD CONSTRAINT "global_notices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
