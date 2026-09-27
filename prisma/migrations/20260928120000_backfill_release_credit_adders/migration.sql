-- #722: attribute every credit written before #721 to the member who wrote it.
--
-- Until #721 a credit could only be written when its release was created, so
-- whoever created the release wrote its credits. Two sources, in order:
--
--   1. the actor of the release's `created` history row, which only the staff
--      create path (`createCommunityRelease`) writes;
--   2. otherwise, the uploader of the release's earliest contribution. The
--      member upload path (`createContributionSubmission`) creates the release,
--      its credits and that first contribution in one transaction, and writes
--      no history row at all, so this is the source for most releases.
--
-- A release with neither leaves its credits null: nothing says who wrote them,
-- and they count for nobody. Only null rows are touched, so a credit #721
-- already attributed keeps its adder, and running this twice changes nothing.

UPDATE "release_artists" AS ra
SET "addedById" = src."actorId"
FROM (
  SELECT
    r."id" AS "releaseId",
    COALESCE(
      (
        SELECT h."actorId"
        FROM "release_histories" h
        WHERE h."releaseId" = r."id" AND h."action" = 'created'
        ORDER BY h."id" ASC
        LIMIT 1
      ),
      (
        SELECT c."userId"
        FROM "contributions" c
        WHERE c."releaseId" = r."id"
        ORDER BY c."id" ASC
        LIMIT 1
      )
    ) AS "actorId"
  FROM "releases" r
) AS src
WHERE ra."releaseId" = src."releaseId"
  AND ra."addedById" IS NULL
  AND src."actorId" IS NOT NULL;
