-- Extend EconomyTransactionReason enum with download + reversal reasons
ALTER TYPE "EconomyTransactionReason" ADD VALUE IF NOT EXISTS 'DOWNLOAD_DEBIT';
ALTER TYPE "EconomyTransactionReason" ADD VALUE IF NOT EXISTS 'DOWNLOAD_CREDIT';
ALTER TYPE "EconomyTransactionReason" ADD VALUE IF NOT EXISTS 'STAFF_REVERSAL';

-- New enum for download grant status
CREATE TYPE "DownloadGrantStatus" AS ENUM ('COMPLETED', 'REVERSED');

-- Add approved accounting bytes to contributions (BigInt for files > 2 GiB)
ALTER TABLE "contributions" ADD COLUMN "approvedAccountingBytes" BIGINT;

-- DownloadAccessGrant table
CREATE TABLE "download_access_grants" (
    "id"             SERIAL        NOT NULL,
    "consumerId"     INTEGER       NOT NULL,
    "contributorId"  INTEGER       NOT NULL,
    "contributionId" INTEGER       NOT NULL,
    "amountBytes"    BIGINT        NOT NULL,
    "status"         "DownloadGrantStatus" NOT NULL DEFAULT 'COMPLETED',
    "idempotencyKey" TEXT,
    "reversedAt"     TIMESTAMP(3),
    "reversalReason" TEXT,
    "reversedById"   INTEGER,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "download_access_grants_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "download_access_grants_consumerId_idx"      ON "download_access_grants"("consumerId");
CREATE INDEX "download_access_grants_contributionId_idx"  ON "download_access_grants"("contributionId");

-- Foreign keys
ALTER TABLE "download_access_grants"
    ADD CONSTRAINT "download_access_grants_consumerId_fkey"
    FOREIGN KEY ("consumerId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "download_access_grants"
    ADD CONSTRAINT "download_access_grants_contributorId_fkey"
    FOREIGN KEY ("contributorId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "download_access_grants"
    ADD CONSTRAINT "download_access_grants_contributionId_fkey"
    FOREIGN KEY ("contributionId") REFERENCES "contributions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "download_access_grants"
    ADD CONSTRAINT "download_access_grants_reversedById_fkey"
    FOREIGN KEY ("reversedById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
