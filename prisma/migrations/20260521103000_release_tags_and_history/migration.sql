CREATE TYPE "ReleaseTagVoteDirection" AS ENUM ('up', 'down');

CREATE TYPE "ReleaseHistoryAction" AS ENUM ('edit', 'tag_added', 'tag_removed');

CREATE TABLE "release_tags" (
    "id" SERIAL NOT NULL,
    "releaseId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,
    "positiveVotes" INTEGER NOT NULL DEFAULT 1,
    "negativeVotes" INTEGER NOT NULL DEFAULT 1,
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "release_tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "release_tag_votes" (
    "id" SERIAL NOT NULL,
    "releaseTagId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "direction" "ReleaseTagVoteDirection" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "release_tag_votes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "release_histories" (
    "id" SERIAL NOT NULL,
    "releaseId" INTEGER NOT NULL,
    "actorId" INTEGER NOT NULL,
    "action" "ReleaseHistoryAction" NOT NULL,
    "summary" VARCHAR(255) NOT NULL,
    "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "release_histories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "release_tags_releaseId_tagId_key" ON "release_tags"("releaseId", "tagId");
CREATE INDEX "release_tags_releaseId_idx" ON "release_tags"("releaseId");
CREATE INDEX "release_tags_tagId_idx" ON "release_tags"("tagId");

CREATE UNIQUE INDEX "release_tag_votes_releaseTagId_userId_direction_key" ON "release_tag_votes"("releaseTagId", "userId", "direction");
CREATE INDEX "release_tag_votes_releaseTagId_idx" ON "release_tag_votes"("releaseTagId");
CREATE INDEX "release_tag_votes_userId_idx" ON "release_tag_votes"("userId");

CREATE INDEX "release_histories_releaseId_createdAt_idx" ON "release_histories"("releaseId", "createdAt");
CREATE INDEX "release_histories_actorId_idx" ON "release_histories"("actorId");

ALTER TABLE "release_tags" ADD CONSTRAINT "release_tags_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "release_tags" ADD CONSTRAINT "release_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "release_tags" ADD CONSTRAINT "release_tags_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "release_tag_votes" ADD CONSTRAINT "release_tag_votes_releaseTagId_fkey" FOREIGN KEY ("releaseTagId") REFERENCES "release_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "release_tag_votes" ADD CONSTRAINT "release_tag_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "release_histories" ADD CONSTRAINT "release_histories_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "release_histories" ADD CONSTRAINT "release_histories_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "release_tags" ("releaseId", "tagId", "updatedAt")
SELECT "A", "B", CURRENT_TIMESTAMP
FROM "_ReleaseToTag";
