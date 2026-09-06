-- CreateEnum
CREATE TYPE "BadPasswordSource" AS ENUM ('SEEDED', 'STAFF');

-- AlterTable
ALTER TABLE "bad_passwords" ADD COLUMN     "source" "BadPasswordSource" NOT NULL DEFAULT 'STAFF';

-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN     "badPasswordsSeededAt" TIMESTAMP(3);
