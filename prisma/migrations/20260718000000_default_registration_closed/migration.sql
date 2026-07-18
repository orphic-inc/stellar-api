-- AlterTable
-- Fresh instances should not accept registrations until the admin deliberately
-- opens them (#332). Existing rows keep their current value.
ALTER TABLE "site_settings" ALTER COLUMN "registrationStatus" SET DEFAULT 'closed';
