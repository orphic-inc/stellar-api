import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

// Depth guard so a corrupt edge can't make the recursion walk forever.
const MAX_INVITE_TREE_DEPTH = 50;

export interface InviteSubtreeEdge {
  userId: number;
  inviterId: number | null;
  depth: number;
}

/**
 * Every descendant of `rootUserId` in the invite tree, the root itself
 * excluded. It reads only `invite_trees` (topology). Pass a transaction client
 * to walk the tree a write is about to act on (#639).
 */
export const getInviteSubtreeEdges = async (
  rootUserId: number,
  client: Prisma.TransactionClient = prisma
): Promise<InviteSubtreeEdge[]> => {
  const edges = await client.$queryRaw<InviteSubtreeEdge[]>`
    WITH RECURSIVE subtree AS (
      SELECT "userId", "inviterId", 1 AS depth
      FROM "invite_trees"
      WHERE "inviterId" = ${rootUserId}
      UNION ALL
      SELECT it."userId", it."inviterId", s.depth + 1
      FROM "invite_trees" it
      JOIN subtree s ON it."inviterId" = s."userId"
      WHERE s.depth < ${MAX_INVITE_TREE_DEPTH}
    )
    SELECT "userId", "inviterId", depth FROM subtree
  `;
  // Postgres returns the computed depth as a bigint.
  return edges.map((e) => ({ ...e, depth: Number(e.depth) }));
};
