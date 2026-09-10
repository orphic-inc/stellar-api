-- Inactivity lifecycle (#279, ADR-0038).
--
-- Three additive, nullable/defaulted columns. Nothing is backfilled and nothing
-- is dropped, so this is safe to run against a populated database.
--
-- users.inactivityWarnedAt / users.reactivatedAt
--   Both nullable, and NULL is the correct starting state for every existing
--   row: nobody has been warned yet, and nobody has been reinstated by a
--   mechanism that did not exist. The dormancy clock reads
--   max(lastLogin, dateRegistered, reactivatedAt), so a NULL reactivatedAt
--   simply drops out of the comparison.
--
--   reactivatedAt exists because the staff re-enable path sets `disabled` to
--   false and touches nothing else. Without a third clock term, the job's
--   disable predicate is still satisfied the morning after a reinstatement --
--   lastLogin and inactivityWarnedAt are both still stale -- and the member is
--   disabled again within 24 hours.
--
-- account_recoveries.purpose
--   DEFAULT 'PasswordReset' so every existing token keeps the only meaning it
--   has ever had, and existing rows need no rewrite. The column exists because
--   resetPasswordWithToken matches any unused, unexpired row: without it a
--   reactivation link mailed to a dormant address would also be able to set
--   that account's password.

-- CreateEnum
CREATE TYPE "RecoveryPurpose" AS ENUM ('PasswordReset', 'Reactivation');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "inactivityWarnedAt" TIMESTAMP(3),
ADD COLUMN     "reactivatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "account_recoveries" ADD COLUMN     "purpose" "RecoveryPurpose" NOT NULL DEFAULT 'PasswordReset';
