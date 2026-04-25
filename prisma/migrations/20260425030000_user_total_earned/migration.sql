-- Add totalEarned to users: gross bytes ever credited via download grants.
-- Unlike `uploaded` (net spendable balance), this field only increments.
-- Used as the ratio numerator in Phase 3.
ALTER TABLE "users" ADD COLUMN "totalEarned" BIGINT NOT NULL DEFAULT 0;

-- Backfill from existing DOWNLOAD_CREDIT ledger entries
UPDATE "users" u
SET "totalEarned" = COALESCE(
  (SELECT SUM(et.amount)
   FROM economy_transactions et
   WHERE et."userId" = u.id
     AND et.reason = 'DOWNLOAD_CREDIT'),
  0
);
