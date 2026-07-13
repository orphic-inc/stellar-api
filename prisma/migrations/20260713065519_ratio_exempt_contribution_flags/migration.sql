-- CreateEnum
CREATE TYPE "RatioExempt" AS ENUM ('NONE', 'FREEPASS', 'NEUTRALPASS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EconomyTransactionReason" ADD VALUE 'FREEPASS_GRANT';
ALTER TYPE "EconomyTransactionReason" ADD VALUE 'NEUTRALPASS_GRANT';

-- AlterTable
ALTER TABLE "contributions" ADD COLUMN     "ratioExempt" "RatioExempt" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "download_access_grants" ADD COLUMN     "ratioExempt" "RatioExempt" NOT NULL DEFAULT 'NONE';
