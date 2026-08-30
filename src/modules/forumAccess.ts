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
