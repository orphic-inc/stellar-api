-- Invite expiry lifecycle (#627, ADR-0041).
--
-- invites.createdAt
--   Invites had no send time. Existing rows are backfilled as expires - 30 days,
--   because every pre-#627 invite was written 30 days out, and it is the only
--   estimate available. Their expires is NOT rewritten: the email they were sent
--   promised 30 days, and that promise is kept.
--
-- InviteStatus
--   'rejected' is dropped (nothing ever wrote it) and 'expired' is added.
--   Postgres cannot drop an enum value in place, so the type is rebuilt. Any
--   'rejected' row is mapped to 'expired' INSIDE the cast: an UPDATE beforehand
--   cannot write 'expired' into the old type, and a plain cast fails on
--   'rejected'.

-- AlterTable
ALTER TABLE "invites" ADD COLUMN "createdAt" TIMESTAMP(3);
UPDATE "invites" SET "createdAt" = "expires" - INTERVAL '30 days';
ALTER TABLE "invites" ALTER COLUMN "createdAt" SET NOT NULL,
ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterEnum
BEGIN;
CREATE TYPE "InviteStatus_new" AS ENUM ('pending', 'accepted', 'expired');
ALTER TABLE "invites" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "invites" ALTER COLUMN "status" TYPE "InviteStatus_new" USING (
  CASE "status"::text WHEN 'rejected' THEN 'expired' ELSE "status"::text END
)::"InviteStatus_new";
ALTER TYPE "InviteStatus" RENAME TO "InviteStatus_old";
ALTER TYPE "InviteStatus_new" RENAME TO "InviteStatus";
DROP TYPE "InviteStatus_old";
ALTER TABLE "invites" ALTER COLUMN "status" SET DEFAULT 'pending';
COMMIT;

-- DropIndex
DROP INDEX "invites_status_idx";

-- CreateIndex
CREATE INDEX "invites_status_expires_idx" ON "invites"("status", "expires");
