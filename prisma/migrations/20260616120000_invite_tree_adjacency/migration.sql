-- Collapse InviteTree to an adjacency list: drop the denormalized nested-set columns.
ALTER TABLE "invite_trees" DROP COLUMN "treePosition";
ALTER TABLE "invite_trees" DROP COLUMN "treeId";
ALTER TABLE "invite_trees" DROP COLUMN "treeLevel";

-- inviterId is now nullable (tree roots have no inviter).
ALTER TABLE "invite_trees" ALTER COLUMN "inviterId" DROP NOT NULL;

-- created timestamp
ALTER TABLE "invite_trees" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- One row per member.
CREATE UNIQUE INDEX "invite_trees_userId_key" ON "invite_trees"("userId");

-- Inviter lookup for the recursive subtree walk.
CREATE INDEX "invite_trees_inviterId_idx" ON "invite_trees"("inviterId");

-- userId FK → cascade on delete; inviterId FK → set null on delete.
ALTER TABLE "invite_trees" DROP CONSTRAINT IF EXISTS "invite_trees_userId_fkey";
ALTER TABLE "invite_trees" ADD CONSTRAINT "invite_trees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invite_trees" ADD CONSTRAINT "invite_trees_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
