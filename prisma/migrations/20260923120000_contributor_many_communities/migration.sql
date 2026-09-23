-- #709, ADR-0050: a contributor belongs to many communities.
--
-- `contributors.communityId` held ONE community per user. The create path kept
-- the first it saw and the add-to-release path moved it to the latest, so the
-- membership union lost communities a member still contributed to. It becomes
-- an m:n relation, the same shape as `consumers` ("CommunityConsumers").
--
-- Order matters: the join table is built and filled BEFORE the column is
-- dropped, because the column is one of the two sources the repair reads.

-- CreateTable
CREATE TABLE "_CommunityContributors" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_CommunityContributors_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_CommunityContributors_B_index" ON "_CommunityContributors"("B");

-- AddForeignKey
ALTER TABLE "_CommunityContributors" ADD CONSTRAINT "_CommunityContributors_A_fkey" FOREIGN KEY ("A") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CommunityContributors" ADD CONSTRAINT "_CommunityContributors_B_fkey" FOREIGN KEY ("B") REFERENCES "contributors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Repair. Two sources, unioned:
--   1. every community a member actually uploaded to: each contribution's
--      release community, keyed by the uploader (a release with no community
--      grants nothing — there is nothing to belong to);
--   2. the community the old column recorded, so no current membership is lost.
-- Past uploads into a private community by a non-member cannot be told apart
-- from legitimate ones (nothing checked access), so they are kept for curators
-- to review on the roster (ADR-0050).
INSERT INTO "_CommunityContributors" ("A", "B")
SELECT r."communityId", ct."id"
FROM "contributions" c
JOIN "releases" r ON r."id" = c."releaseId"
JOIN "contributors" ct ON ct."userId" = c."userId"
WHERE r."communityId" IS NOT NULL
UNION
SELECT ct."communityId", ct."id"
FROM "contributors" ct
ON CONFLICT DO NOTHING;

-- DropForeignKey
ALTER TABLE "contributors" DROP CONSTRAINT "contributors_communityId_fkey";

-- AlterTable
ALTER TABLE "contributors" DROP COLUMN "communityId";
