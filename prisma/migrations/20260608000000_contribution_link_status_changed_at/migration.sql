-- Track when a contribution's linkStatus last changed, so the WARN->FAIL
-- sweep (ADR-0006) can measure "stuck at WARN for >72h". linkCheckedAt is
-- last-checked, not first-warned, so it can't serve this purpose.
ALTER TABLE "contributions" ADD COLUMN "linkStatusChangedAt" TIMESTAMP(3);

-- Backfill existing rows with their last check time (best available proxy)
-- so pre-existing WARN links get a clock and become sweepable.
UPDATE "contributions" SET "linkStatusChangedAt" = "linkCheckedAt" WHERE "linkCheckedAt" IS NOT NULL;
