-- #897, ADR-0054: a community's leadership log, one row per change of leader.
-- Product history in its own table; the audit log stays forensic.

-- CreateEnum
CREATE TYPE "LeadershipEventKind" AS ENUM ('founded', 'assigned', 'handed_off', 'cleared');

-- CreateTable
CREATE TABLE "community_leadership_events" (
    "id" SERIAL NOT NULL,
    "communityId" INTEGER NOT NULL,
    "kind" "LeadershipEventKind" NOT NULL,
    "fromUserId" INTEGER,
    "toUserId" INTEGER,
    "actorId" INTEGER,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_leadership_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "community_leadership_events_communityId_at_idx" ON "community_leadership_events"("communityId", "at");

-- AddForeignKey
ALTER TABLE "community_leadership_events" ADD CONSTRAINT "community_leadership_events_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_leadership_events" ADD CONSTRAINT "community_leadership_events_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_leadership_events" ADD CONSTRAINT "community_leadership_events_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_leadership_events" ADD CONSTRAINT "community_leadership_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- BEGIN BACKFILL (ADR-0054 §6)
-- Run once, here. communityLeadershipLog.integration.ts re-runs this block
-- against seeded audit rows, so keep it between the markers, one statement per
-- `;` at a line end.

-- Each `community.leader.set` audit row is one event, skipping no-ops: a staff
-- PUT audited the leader whenever it was sent, changed or not (#901). The kind
-- comes from the metadata: create writes no `previousLeaderId`; a handoff writes
-- a `community.leader.accept` row too, by the new leader, in the same transaction.
INSERT INTO "community_leadership_events" ("communityId", "kind", "fromUserId", "toUserId", "actorId", "at")
SELECT a."targetId",
  (CASE
    WHEN NOT (a."metadata" ? 'previousLeaderId') THEN 'founded'
    WHEN jsonb_typeof(a."metadata" -> 'leaderId') = 'null' THEN 'cleared'
    WHEN EXISTS (
      SELECT 1 FROM "audit_logs" x
      WHERE x."action" = 'community.leader.accept'
        AND x."targetType" = 'community'
        AND x."targetId" = a."targetId"
        AND x."actorId" = a."actorId"
        AND abs(extract(epoch FROM (x."createdAt" - a."createdAt"))) < 5
    ) THEN 'handed_off'
    ELSE 'assigned'
  END)::"LeadershipEventKind",
  (a."metadata" ->> 'previousLeaderId')::int,
  (a."metadata" ->> 'leaderId')::int,
  a."actorId",
  a."createdAt"
FROM "audit_logs" a
JOIN "communities" c ON c."id" = a."targetId"
WHERE a."action" = 'community.leader.set'
  AND a."targetType" = 'community'
  AND NOT (
    a."metadata" ? 'previousLeaderId'
    AND (a."metadata" -> 'leaderId') = (a."metadata" -> 'previousLeaderId')
  )
ORDER BY a."createdAt", a."id";

-- A leader no audit row explains gets a `founded` at the community's creation,
-- with no actor: the boot seed's site community, and fixtures. That is a
-- community with a leader and no events, or one whose first event replaces
-- someone.
INSERT INTO "community_leadership_events" ("communityId", "kind", "fromUserId", "toUserId", "actorId", "at")
SELECT c."id", 'founded'::"LeadershipEventKind", NULL, COALESCE(f."fromUserId", c."leaderId"), NULL, c."createdAt"
FROM "communities" c
LEFT JOIN LATERAL (
  SELECT e."fromUserId", e."id"
  FROM "community_leadership_events" e
  WHERE e."communityId" = c."id"
  ORDER BY e."at", e."id"
  LIMIT 1
) f ON true
WHERE (f."id" IS NULL AND c."leaderId" IS NOT NULL)
   OR (f."id" IS NOT NULL AND f."fromUserId" IS NOT NULL);
-- END BACKFILL
