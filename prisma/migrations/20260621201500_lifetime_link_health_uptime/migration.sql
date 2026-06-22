-- AlterTable
ALTER TABLE "contributions" ADD COLUMN     "healthyMs" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "healthySince" TIMESTAMP(3);

-- Cold start (ADR-0019, #95): seed the open PASS segment for currently-healthy
-- links so accrual begins at launch rather than drifting up to a week before the
-- next probe opens their segment. No healthyMs is back-filled — nobody is
-- credited uptime that was never confirmed.
UPDATE "contributions" SET "healthySince" = CURRENT_TIMESTAMP WHERE "linkStatus" = 'PASS';
