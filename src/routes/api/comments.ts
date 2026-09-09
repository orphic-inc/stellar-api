import express, { Request, Response } from 'express';
import { Prisma, CommentPage, SubscriptionPage } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { translatePrismaError } from '../../lib/prismaErrors';
import {
  emitNotifications,
  extractMentionedUsernames,
  extractNewMentionedUsernames
} from '../../lib/notifications';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { loadPermissions, hasPermission } from '../../middleware/permissions';
import {
  parsedBody,
  validate,
  validateParams,
  validateQuery,
  parsedParams,
  parsedQuery
} from '../../middleware/validate';
import { sanitizeHtml } from '../../lib/sanitize';
import { parsedPage, paginatedResponse } from '../../lib/pagination';
import {
  commentQuerySchema,
  createCommentSchema,
  updateCommentSchema,
  type CommentQueryInput,
  type CreateCommentInput,
  type UpdateCommentInput
} from '../../schemas/comment';
import { deleteComment } from '../../modules/comment';
import { renderSiteBBCode, resolveViewer } from '../../modules/bbcodeRender';
import { authorRefSelect, toAuthorRefOrNull } from '../../modules/authorRef';

/** Which comment page maps to which subscription page, and the id field on the
 *  comment that identifies the thing subscribed to. A table rather than six
 *  branches, so the lookup below stays trivial. */
const SUBSCRIPTION_TARGETS: Partial<
  Record<CommentPage, { subPage: SubscriptionPage; field: string }>
> = {
  release: { subPage: 'release', field: 'releaseId' },
  requests: { subPage: 'requests', field: 'requestId' },
  artist: { subPage: 'artist', field: 'artistId' },
  collages: { subPage: 'collages', field: 'collageId' },
  communities: { subPage: 'communities', field: 'communityId' },
  contributions: { subPage: 'contributions', field: 'contributionId' }
};

/**
 * Which subscription page a comment belongs to, and the id within it.
 *
 * Lifted out of the edit handler so it keeps room for its #564 guard — a guard
 * must sit lexically in the handler that owns the write, so the surrounding
 * logic is what moves.
 */
const subscriptionTargetFor = (
  comment: Record<string, unknown> & { page: string }
): { subPage: SubscriptionPage; pageId: number | undefined } | undefined => {
  const target = SUBSCRIPTION_TARGETS[comment.page as CommentPage];
  if (!target) return undefined;
  return {
    subPage: target.subPage,
    pageId: (comment[target.field] as number | null) ?? undefined
  };
};

/** Tell everyone subscribed to the page that a new comment landed. */
const notifySubscribers = async (
  tx: Prisma.TransactionClient,
  target: { subPage: SubscriptionPage; pageId: number },
  actorId: number
): Promise<void> => {
  const subs = await tx.commentSubscription.findMany({
    where: { page: target.subPage, pageId: target.pageId },
    select: { userId: true }
  });
  if (subs.length === 0) return;
  await emitNotifications(tx, {
    userIds: subs.map((s) => s.userId),
    type: 'comment_sub',
    actorId,
    page: target.subPage,
    pageId: target.pageId
  });
};

/** Tell anyone the comment body quotes that they were mentioned. */
const notifyQuoted = async (
  tx: Prisma.TransactionClient,
  target: { subPage: SubscriptionPage; pageId: number },
  actorId: number,
  body: string,
  commentId: number
): Promise<void> => {
  const usernames = extractMentionedUsernames(body);
  if (usernames.length === 0) return;
  const quoted = await tx.user.findMany({
    where: {
      username: { in: usernames, mode: 'insensitive' },
      disabled: false
    },
    select: { id: true }
  });
  // postId stores the comment id for potential future deep-link use; the UI only
  // uses postId for forum-page anchors, so this is safe for all other pages.
  await emitNotifications(tx, {
    userIds: quoted.map((u) => u.id),
    type: 'forum_quote',
    actorId,
    page: target.subPage,
    pageId: target.pageId,
    postId: commentId
  });
};

const router = express.Router();
const commentIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

// GET /api/comments
//
// `requireAuth` here closes the other half of #509 F4 (#547). That fix gated
// `/comments/{id}` because a comment body "was readable with no session at all
// by guessing an integer id" — while this route returned the same bodies, plus
// rendered `bodyHtml` and author refs, PAGINATED. The detail route was gated
// and the bulk route beside it was not, so no guessing was ever required.
router.get(
  '/',
  requireAuth,
  validateQuery(commentQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { context, pageId } = parsedQuery<CommentQueryInput>(res);
    const pg = parsedPage(res);
    const where: Record<string, unknown> = {};
    if (context) where.page = context as CommentPage;
    if (context && pageId) {
      if (context === CommentPage.communities) where.communityId = pageId;
      else if (context === CommentPage.artist) where.artistId = pageId;
      else if (context === CommentPage.collages) where.collageId = pageId;
      else if (context === CommentPage.contributions)
        where.contributionId = pageId;
      else if (context === CommentPage.requests) where.requestId = pageId;
      else if (context === CommentPage.release) where.releaseId = pageId;
    }
    const [comments, total] = await Promise.all([
      prisma.comment.findMany({
        where: { ...where, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        skip: pg.skip,
        take: pg.limit,
        include: {
          author: { select: authorRefSelect },
          editedUser: { select: { id: true, username: true } }
        }
      }),
      prisma.comment.count({ where: { ...where, deletedAt: null } })
    ]);
    // Resolved ONCE for the request: this list renders in a loop, so a per-row
    // lookup would issue one identical settings query per row (#400).
    const bbViewer = await resolveViewer(req);
    const mapped = await Promise.all(
      comments.map(async (comment) => ({
        ...comment,
        author: toAuthorRefOrNull(comment.author),
        bodyHtml: await renderSiteBBCode(comment.body, bbViewer)
      }))
    );
    paginatedResponse(res, mapped, total, pg);
  })
);

// GET /api/comments/:id
//
// Two defects, one route (#509 F4). It had no `requireAuth` — the only comment
// route without one — and no `deletedAt` filter, which the sibling list above
// applies at both its `findMany` and its `count`. `deleteComment` only stamps
// `deletedAt` and keeps the body verbatim, so a soft-deleted comment was
// readable **with no session at all** by guessing an integer id.
//
// The gate costs nothing downstream: stellar-ui's `commentApi` reads
// `/comments` for the list and `/comments/{id}` only for PUT and DELETE. It
// never GETs this route.
router.get(
  '/:id',
  requireAuth,
  validateParams(commentIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    const comment = await prisma.comment.findUnique({
      where: { id, deletedAt: null },
      include: {
        author: { select: authorRefSelect }
      }
    });
    if (!comment) return res.status(404).json({ msg: 'Comment not found' });
    res.json({
      ...comment,
      author: toAuthorRefOrNull(comment.author),
      bodyHtml: await renderSiteBBCode(comment.body, await resolveViewer(req))
    });
  })
);

// POST /api/comments
router.post(
  '/',
  requireAuth,
  validate(createCommentSchema),
  authHandler(async (req, res) => {
    const {
      page,
      body,
      communityId,
      contributionId,
      requestId,
      artistId,
      releaseId,
      collageId
    } = parsedBody<CreateCommentInput>(res);

    // Map CommentPage + entity FK to SubscriptionPage + pageId for notification lookup
    const subPageMap: Partial<
      Record<
        CommentPage,
        { subPage: SubscriptionPage; pageId: number | undefined }
      >
    > = {
      release: { subPage: 'release', pageId: releaseId },
      requests: { subPage: 'requests', pageId: requestId },
      artist: { subPage: 'artist', pageId: artistId },
      collages: { subPage: 'collages', pageId: collageId },
      communities: { subPage: 'communities', pageId: communityId },
      contributions: { subPage: 'contributions', pageId: contributionId }
    };
    const subTarget = subPageMap[page];

    let comment;
    try {
      comment = await prisma.$transaction(async (tx) => {
        const created = await tx.comment.create({
          data: {
            page,
            body: sanitizeHtml(body),
            authorId: req.user.id,
            ...(communityId && { communityId }),
            ...(contributionId && { contributionId }),
            ...(requestId && { requestId }),
            ...(artistId && { artistId }),
            ...(releaseId && { releaseId }),
            ...(collageId && { collageId })
          },
          include: {
            author: { select: authorRefSelect }
          }
        });

        const { subPage, pageId } = subTarget ?? {};
        if (pageId !== undefined && subPage !== undefined) {
          const target = { subPage, pageId };
          await notifySubscribers(tx, target, req.user.id);
          await notifyQuoted(tx, target, req.user.id, body, created.id);
        }

        return created;
      });
    } catch (err) {
      // Every id in the body names another model — an artist, community,
      // contribution, request, release or collage — so a dangling one is a
      // payload problem rather than a missing route (#564).
      translatePrismaError(err, {
        P2003: [400, 'The commented item was not found']
      });
    }

    res.status(201).json({
      ...comment,
      author: toAuthorRefOrNull(comment.author),
      bodyHtml: await renderSiteBBCode(comment.body, await resolveViewer(req))
    });
  })
);

// PUT /api/comments/:id
router.put(
  '/:id',
  requireAuth,
  validateParams(commentIdParamsSchema),
  validate(updateCommentSchema),
  authHandler(async (req, res) => {
    const { body } = parsedBody<UpdateCommentInput>(res);
    const { id } = parsedParams<{ id: number }>(res);
    const comment = await prisma.comment.findUnique({ where: { id } });
    if (!comment) return res.status(404).json({ msg: 'Comment not found' });
    if (comment.authorId !== req.user.id)
      return res.status(403).json({ msg: 'Not authorized' });

    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        const result = await tx.comment.update({
          where: { id },
          data: {
            body: sanitizeHtml(body),
            editedUserId: req.user.id,
            editedAt: new Date()
          }
        });

        const subTarget = subscriptionTargetFor(comment);

        if (subTarget?.pageId) {
          const newlyQuotedUsernames = extractNewMentionedUsernames(
            comment.body,
            body
          );
          if (newlyQuotedUsernames.length > 0) {
            const quotedUsers = await tx.user.findMany({
              where: {
                username: { in: newlyQuotedUsernames, mode: 'insensitive' },
                disabled: false
              },
              select: { id: true }
            });
            await emitNotifications(tx, {
              userIds: quotedUsers.map((u) => u.id),
              type: 'forum_quote',
              actorId: req.user.id,
              page: subTarget.subPage,
              pageId: subTarget.pageId,
              postId: id
            });
          }
        }

        return result;
      });
    } catch (err) {
      translatePrismaError(err, { P2025: [404, 'Comment not found'] });
    }

    res.json({
      ...updated,
      bodyHtml: await renderSiteBBCode(updated.body, await resolveViewer(req))
    });
  })
);

// DELETE /api/comments/:id
router.delete(
  '/:id',
  requireAuth,
  validateParams(commentIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);

    const comment = await prisma.comment.findUnique({ where: { id } });
    if (!comment) return res.status(404).json({ msg: 'Comment not found' });

    const isOwner = comment.authorId === req.user.id;
    if (
      !isOwner &&
      !hasPermission(await loadPermissions(req, res), 'reports_manage')
    ) {
      return res.status(403).json({ msg: 'Not authorized' });
    }

    await deleteComment(id, req.user.id, !isOwner);
    res.status(204).send();
  })
);

export default router;
