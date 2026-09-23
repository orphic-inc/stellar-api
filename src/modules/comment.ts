import { Comment, CommentPage } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  communityReadableWhere,
  contributionVisibleTo,
  releaseVisibleTo,
  requestVisibleTo
} from './communityAccess';

export const deleteComment = async (
  id: number,
  actorId: number,
  isModAction: boolean
) =>
  prisma.$transaction([
    // Only a live comment (#703): a second delete throws P2025 and the batch
    // drops its audit row, rather than re-stamping and logging it twice.
    prisma.comment.update({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() }
    }),
    prisma.auditLog.create({
      data: {
        actorId,
        action: isModAction ? 'comment.mod_delete' : 'comment.delete',
        targetType: 'Comment',
        targetId: id
      }
    })
  ]);

type ThreadCheck = (pageId: number, viewerId: number) => Promise<boolean>;

/**
 * Who may see each kind of thread (#697). A thread belongs to its page, so it
 * follows that page's access, read through the per-entity fragments in
 * communityAccess.ts rather than restated here.
 *
 * A `Record` over `CommentPage`, so a new page fails to compile until someone
 * decides who may see its thread. Not shared with notificationAccess.ts: the
 * two enums share names, not meaning, and each maps onto the same fragments.
 *
 * `artist` and `collages` are site-wide, so their check is only that the page
 * exists. Every check answers false for a page that does not exist.
 */
const THREAD_CHECKS: Record<CommentPage, ThreadCheck> = {
  release: async (id, viewerId) =>
    (await prisma.release.count({
      where: { AND: [{ id }, releaseVisibleTo(viewerId)] }
    })) > 0,
  contributions: async (id, viewerId) =>
    (await prisma.contribution.count({
      where: { AND: [{ id }, contributionVisibleTo(viewerId)] }
    })) > 0,
  requests: async (id, viewerId) =>
    (await prisma.request.count({
      where: { AND: [{ id }, requestVisibleTo(viewerId)] }
    })) > 0,
  communities: async (id, viewerId) =>
    (await prisma.community.count({
      where: { AND: [{ id }, communityReadableWhere(viewerId)] }
    })) > 0,
  artist: async (id) => (await prisma.artist.count({ where: { id } })) > 0,
  collages: async (id) => (await prisma.collage.count({ where: { id } })) > 0
};

/**
 * Whether this viewer may read or write the thread on this page (#697). A page
 * that does not exist and a page the viewer cannot see are the same `false`, so
 * a caller that refuses on it cannot be used to probe for private ids.
 */
export const canSeeCommentThread = (
  page: CommentPage,
  pageId: number,
  viewerId: number
): Promise<boolean> => THREAD_CHECKS[page](pageId, viewerId);

/** The column on a comment that names its page, per kind of thread. */
const THREAD_FIELDS: Record<
  CommentPage,
  | 'releaseId'
  | 'contributionId'
  | 'requestId'
  | 'communityId'
  | 'artistId'
  | 'collageId'
> = {
  release: 'releaseId',
  contributions: 'contributionId',
  requests: 'requestId',
  communities: 'communityId',
  artist: 'artistId',
  collages: 'collageId'
};

/**
 * `canSeeCommentThread` for a stored comment, reading its page off the row. A
 * comment with no id in its page's column belongs to no thread anyone can be
 * shown, so it answers false.
 */
export const canSeeThreadOf = (
  comment: Pick<Comment, 'page' | (typeof THREAD_FIELDS)[CommentPage]>,
  viewerId: number
): Promise<boolean> => {
  const pageId = comment[THREAD_FIELDS[comment.page]];
  return pageId === null
    ? Promise.resolve(false)
    : canSeeCommentThread(comment.page, pageId, viewerId);
};
