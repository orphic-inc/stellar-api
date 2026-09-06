import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { canAccessForumLevel } from '../lib/userRankAccess';
import type { AuthUser } from '../types/auth';

/**
 * Assert the caller's rank clears a forum's read floor, or throw.
 *
 * Four routes across `forumPost.ts` and `forumTopic.ts` carried this verbatim —
 * the same select, the same 404, the same 403 wording. Forum class enforcement
 * is one of the things this codebase has already had to audit into place, so
 * having one spelling of the read gate matters more than the four lines it
 * saves: a fifth route added later inherits the check instead of re-deriving it.
 *
 * Only the *read* floor lives here. `minClassCreate` and the moderator-gated
 * paths are checked differently at their call sites and are deliberately left
 * alone.
 */
export const assertForumReadAccess = async (
  user: AuthUser,
  forumId: number
): Promise<void> => {
  const forum = await prisma.forum.findUnique({
    where: { id: forumId },
    select: { minClassRead: true }
  });
  if (!forum) throw new AppError(404, 'Forum not found');
  if (!canAccessForumLevel(user, forumId, forum.minClassRead)) {
    throw new AppError(403, 'Insufficient class to read this forum');
  }
};

/**
 * The same rule as `canAccessForumLevel`, expressed as a `where` fragment.
 *
 * The assert above answers "may this member read forum X?" one forum at a time,
 * which is all a topic or post route needs — it already knows its `forumId`.
 * A *search* has the question the other way round: it spans every forum at once
 * and must never surface a row from one the caller cannot read. There is no
 * forum id to check, so the rule has to travel into the query.
 *
 * The two must stay in step. `forumAccess.spec.ts` asserts the fragment and the
 * predicate agree over a matrix of levels and permits — the drift ADR-0010
 * warns about, and the reason this lives next to its predicate rather than in
 * the one route that currently needs it.
 *
 * Both arms are required, and the second is not cosmetic: `permittedForumIds`
 * grants a specific forum to a rank *below* its read floor, so a level-only
 * filter would hide forums the member has been explicitly admitted to.
 */
export const forumReadableWhere = (
  user: Pick<AuthUser, 'userRankLevel'> & { permittedForumIds?: number[] }
): Prisma.ForumWhereInput => ({
  OR: [
    { minClassRead: { lte: user.userRankLevel } },
    { id: { in: user.permittedForumIds ?? [] } }
  ]
});
