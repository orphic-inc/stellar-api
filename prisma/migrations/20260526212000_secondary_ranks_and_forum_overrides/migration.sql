ALTER TABLE "user_ranks"
ADD COLUMN "secondary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "permittedForumIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

CREATE TABLE "user_secondary_ranks" (
  "userId" INTEGER NOT NULL,
  "userRankId" INTEGER NOT NULL,
  "assignedById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_secondary_ranks_pkey" PRIMARY KEY ("userId", "userRankId")
);

CREATE INDEX "user_secondary_ranks_userRankId_idx" ON "user_secondary_ranks"("userRankId");
CREATE INDEX "user_secondary_ranks_assignedById_idx" ON "user_secondary_ranks"("assignedById");

ALTER TABLE "user_secondary_ranks"
ADD CONSTRAINT "user_secondary_ranks_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_secondary_ranks"
ADD CONSTRAINT "user_secondary_ranks_userRankId_fkey"
FOREIGN KEY ("userRankId") REFERENCES "user_ranks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_secondary_ranks"
ADD CONSTRAINT "user_secondary_ranks_assignedById_fkey"
FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
