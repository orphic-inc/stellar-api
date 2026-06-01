-- Backfill: clear stored Gravatar avatar URLs.
--
-- Gravatar was removed because it leaks a hash of the user's email to a
-- third party (Automattic) on every avatar render — unacceptable for a
-- private site. New users register with a null avatar and the UI falls
-- back to the bundled default. This one-off script nulls out existing
-- Gravatar URLs so already-registered users stop leaking and pick up the
-- same default.
--
-- Data-only — no schema change. Run manually against the target database:
--   psql "$STELLAR_PSQL_URI" -f prisma/scripts/backfill-remove-gravatar-avatars.sql
--
-- Idempotent: re-running is a no-op once the URLs are cleared.

UPDATE "User"
SET "avatar" = NULL
WHERE "avatar" LIKE '%gravatar.com%'
   OR "avatar" LIKE '%gravatar.test%';

UPDATE "Profile"
SET "avatar" = NULL
WHERE "avatar" LIKE '%gravatar.com%'
   OR "avatar" LIKE '%gravatar.test%';
