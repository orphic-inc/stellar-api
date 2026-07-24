-- ADR-0030 slice 2: where a community's contributions get announced.
--
-- Orthogonal to `registrationStatus` (which gates joining), so it is a new
-- column rather than an overload of that one: a community can register openly
-- and announce privately, or the reverse.
--
-- Named `announceVisibility`, not `visibility`, because it routes announce
-- delivery and must never enter an access check (ADR-0015, Golden Rule 3).
--
-- Defaults to PUBLIC, so every existing community keeps today's `#announce`
-- behaviour and the change is forward-safe on its own.

-- CreateEnum
CREATE TYPE "AnnounceVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterTable
ALTER TABLE "communities" ADD COLUMN "announceVisibility" "AnnounceVisibility" NOT NULL DEFAULT 'PUBLIC';
