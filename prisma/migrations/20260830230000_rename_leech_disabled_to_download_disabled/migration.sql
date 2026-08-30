-- #345: RatioPolicyStatus.LEECH_DISABLED → DOWNLOAD_DISABLED, and
-- RatioPolicyState.leechDisabledAt → downloadDisabledAt.
--
-- "Leech" is legacy-tracker terminology that outlived the move to Stellar's own
-- vocabulary, and both surfaces are in the wire contract, so this is a breaking
-- rename paired with a stellar-ui change.
--
-- `download`, not `consumption`: this status IS the canDownload flag. ratioPolicy.ts
-- sets `canDownload: newStatus !== DOWNLOAD_DISABLED`, and downloads.ts gates on it.
-- `consumed`/`Consumer` name the accounting and membership axis; this sits on the
-- retrieval axis, alongside DownloadAccessGrant and /api/downloads.
--
-- WRITTEN BY HAND, DELIBERATELY — same reason as
-- 20260724120000_rename_community_staff_to_curators. Prisma renders an enum value
-- change as a drop-and-recreate of the type, which cannot work while a column
-- depends on it and would discard every ratio_policy_states row if it did. Both
-- statements below are pure renames: no data moves, no row is rewritten.
--
-- ALTER TYPE ... RENAME VALUE requires Postgres 10+; CI and compose both run 16.
--
-- The original CREATE TYPE in 20260425040000_ratio_policy_state is deliberately
-- left alone. Migrations are immutable history — editing one changes its checksum
-- and breaks `prisma migrate deploy` on every database that already applied it.

ALTER TYPE "RatioPolicyStatus" RENAME VALUE 'LEECH_DISABLED' TO 'DOWNLOAD_DISABLED';

ALTER TABLE "ratio_policy_states" RENAME COLUMN "leechDisabledAt" TO "downloadDisabledAt";
