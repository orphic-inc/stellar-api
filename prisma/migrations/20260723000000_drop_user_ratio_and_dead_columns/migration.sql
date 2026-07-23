-- #294: drop accidental accounting state from `users`.
--
-- `ratio` was a stored denormalization of computeRatio(contributed, consumed) —
-- a pure function of two adjacent columns, in no WHERE or ORDER BY, so it bought
-- no query performance and only created drift surface. Now computed at read time.
--
-- `ratioWatchDownload` was superseded by RatioPolicyState (which carries
-- consumedAtWatchStart and derives the watch-period delta); nothing read it.
--
-- `totalEarned` had zero production references of any kind.
--
-- Pre-alpha: destructive drop, no data migration. `contributed`/`consumed` (real
-- CAS-incremented state) and `canDownload` (an independent capability flag) stay.
ALTER TABLE "users" DROP COLUMN "ratio";
ALTER TABLE "users" DROP COLUMN "ratioWatchDownload";
ALTER TABLE "users" DROP COLUMN "totalEarned";
