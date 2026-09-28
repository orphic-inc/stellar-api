-- #732: a ratio-exemption change (Freepass / Neutralpass) writes a release
-- history row, so it is visible on the release page rather than only in the
-- audit log, which no route reads.
--
-- Not revertable: `revert` accepts only `edit` rows, and the exemption is not
-- part of the release snapshot.

-- AlterEnum
ALTER TYPE "ReleaseHistoryAction" ADD VALUE 'ratio_exempt_changed';
