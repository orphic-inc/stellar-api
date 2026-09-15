-- Backfill RatioPolicyState.disabledCause (#646).
--
-- Before #646 a ratio-caused disable and a staff override wrote the same
-- status, but not the same watch fields: the automatic disable enters from
-- WATCH and keeps "watchStartedAt", while the staff override to
-- DOWNLOAD_DISABLED writes it null. A data-only migration of its own, so an
-- integration test can run exactly this SQL.
UPDATE "ratio_policy_states"
SET "disabledCause" = CASE
  WHEN "watchStartedAt" IS NOT NULL THEN 'RATIO'::"RatioDisableCause"
  ELSE 'STAFF'::"RatioDisableCause"
END
WHERE "status" = 'DOWNLOAD_DISABLED' AND "disabledCause" IS NULL;
