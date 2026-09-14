-- Withdraw RecoveryPurpose.Reactivation (#629, ADR-0038 §2 amended).
--
-- The in-app reactivation flow (#279) is gone: a disabled member asks staff on
-- IRC and staff re-enable from the UI. The purpose column stays, with one value.
--
-- Postgres cannot drop an enum value in place, so the type is rebuilt and the
-- column cast across. That cast FAILS on any row still holding 'Reactivation',
-- so those rows go first. They are 2-hour, single-purpose tokens that nothing
-- can consume any more.

DELETE FROM "account_recoveries" WHERE "purpose" = 'Reactivation';

-- AlterEnum
BEGIN;
CREATE TYPE "RecoveryPurpose_new" AS ENUM ('PasswordReset');
ALTER TABLE "account_recoveries" ALTER COLUMN "purpose" DROP DEFAULT;
ALTER TABLE "account_recoveries" ALTER COLUMN "purpose" TYPE "RecoveryPurpose_new" USING ("purpose"::text::"RecoveryPurpose_new");
ALTER TYPE "RecoveryPurpose" RENAME TO "RecoveryPurpose_old";
ALTER TYPE "RecoveryPurpose_new" RENAME TO "RecoveryPurpose";
DROP TYPE "RecoveryPurpose_old";
ALTER TABLE "account_recoveries" ALTER COLUMN "purpose" SET DEFAULT 'PasswordReset';
COMMIT;
