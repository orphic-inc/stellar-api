-- #882: the boot seed no longer rewrites existing ranks, so #876's change to the
-- seeded entry rank (assetLimit 0 -> 1, so a new member can upload an avatar)
-- reaches existing installs here instead. Keyed on the entry level, not the
-- name, so a renamed entry rank gets it too; any value other than the old
-- seeded 0 is left alone. Data only; no schema change.
UPDATE "user_ranks" SET "assetLimit" = 1 WHERE "level" = 100 AND "assetLimit" = 0;
