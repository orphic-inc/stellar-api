-- Every account has an InviteTree row (#633, ADR-0042).
--
-- Registration never wrote the who-invited-whom edge, so on a real instance the
-- table is empty. This gives every user without a row a row, and recovers the
-- inviter where the data allows it. Rows that already exist are left alone.
--
-- A member's REGISTRATION email is the oldEmail of their earliest
-- user_email_histories row, or their current email if they have none.
-- changeEmail is the only writer of users.email and has always written history.
--
-- Their inviter is the inviter of the accepted invite to that address, where
--   - the member is not the inviter,
--   - the member registered at or after the invite was sent (invites.createdAt
--     is exact: before #627 expires was always send time + 30 days), and
--   - among those, the earliest registrant wins.
-- "Earliest registrant with that email" alone is wrong: a member who registered
-- an address openly, changed email and then invited that address would be
-- recorded as having invited themselves.
--
-- createdAt is the member's dateRegistered, so it means "when this relationship
-- began" for old rows exactly as it does for new ones.

WITH registration_email AS (
  SELECT
    u."id" AS "userId",
    u."dateRegistered",
    lower(COALESCE(
      (
        SELECT h."oldEmail"
        FROM "user_email_histories" h
        WHERE h."userId" = u."id"
        ORDER BY h."changedAt" ASC, h."id" ASC
        LIMIT 1
      ),
      u."email"
    )) AS "email"
  FROM "users" u
),
candidate AS (
  SELECT
    r."userId",
    i."inviterId",
    ROW_NUMBER() OVER (
      PARTITION BY i."id"
      ORDER BY r."dateRegistered" ASC, r."userId" ASC
    ) AS "rank"
  FROM "invites" i
  JOIN registration_email r ON r."email" = lower(i."email")
  WHERE i."status" = 'accepted'
    AND r."userId" <> i."inviterId"
    AND r."dateRegistered" >= i."createdAt"
)
INSERT INTO "invite_trees" ("userId", "inviterId", "createdAt")
SELECT u."id", c."inviterId", u."dateRegistered"
FROM "users" u
LEFT JOIN candidate c ON c."userId" = u."id" AND c."rank" = 1
WHERE NOT EXISTS (
  SELECT 1 FROM "invite_trees" t WHERE t."userId" = u."id"
);
