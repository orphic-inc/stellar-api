-- Existing email_blacklists rows were written verbatim, because nothing ever
-- read them (#540) and so nothing cared about their case. Enforcement compares
-- against a lowercased address, so a row of `Spam@Example.com` would sit in the
-- table unable to match anything -- the same unmatchable-row failure the fix is
-- about.
--
-- TRIM as well as LOWER: the column has never been trimmed on write either, and
-- a trailing space is just as unmatchable as a capital letter.
UPDATE "email_blacklists" SET "email" = LOWER(TRIM("email"))
WHERE "email" <> LOWER(TRIM("email"));
