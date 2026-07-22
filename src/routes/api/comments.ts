import express, { Request, Response } from 'express';
import { CommentPage, SubscriptionPage } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
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
import { renderSiteBBCode } from '../../modules/bbcodeRender';
import { authorRefSelect, toAuthorRefOrNull } from '../../modules/authorRef';

const router = express.Router();
const commentIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

// GET /api/comments
router.get(
  '/',
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
    const mapped = await Promise.all(
      comments.map(async (comment) => ({
        ...comment,
        author: toAuthorRefOrNull(comment.author),
        bodyHtml: await renderSiteBBCode(comment.body)
      }))
    );
    paginatedResponse(res, mapped, total, pg);
  })
);

// GET /api/comments/:id
router.get(
  '/:id',
  validateParams(commentIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = parsedParams<{ id: number }>(res);
    const comment = await prisma.comment.findUnique({
      where: { id },
      include: {
        author: { select: authorRefSelect }
      }
    });
    if (!comment) return res.status(404).json({ msg: 'Comment not found' });
    res.json({
      ...comment,
      author: toAuthorRefOrNull(comment.author),
      bodyHtml: await renderSiteBBCode(comment.body)
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

    const comment = await prisma.$transaction(async (tx) => {
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

      if (subTarget?.pageId) {
        const subs = await tx.commentSubscription.findMany({
          where: { page: subTarget.subPage, pageId: subTarget.pageId },
          select: { userId: true }
        });
        if (subs.length > 0) {
          await emitNotifications(tx, {
            userIds: subs.map((s) => s.userId),
            type: 'comment_sub',
            actorId: req.user.id,
            page: subTarget.subPage,
            pageId: subTarget.pageId
          });
        }

        const quotedUsernames = extractMentionedUsernames(body);
        if (quotedUsernames.length > 0) {
          const quotedUsers = await tx.user.findMany({
            where: {
              username: { in: quotedUsernames, mode: 'insensitive' },
              disabled: false
            },
            select: { id: true }
          });
          // postId stores the comment id for potential future deep-link use;
          // the UI only uses postId for forum-page anchors so this is safe for all other pages.
          await emitNotifications(tx, {
            userIds: quotedUsers.map((u) => u.id),
            type: 'forum_quote',
            actorId: req.user.id,
            page: subTarget.subPage,
            pageId: subTarget.pageId,
            postId: created.id
          });
        }
      }

      return created;
    });

    res.status(201).json({
      ...comment,
      author: toAuthorRefOrNull(comment.author),
      bodyHtml: await renderSiteBBCode(comment.body)
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

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.comment.update({
        where: { id },
        data: {
          body: sanitizeHtml(body),
          editedUserId: req.user.id,
          editedAt: new Date()
        }
      });

      const subPageMap: Partial<
        Record<
          CommentPage,
          { subPage: SubscriptionPage; pageId: number | undefined }
        >
      > = {
        release: { subPage: 'release', pageId: comment.releaseId ?? undefined },
        requests: {
          subPage: 'requests',
          pageId: comment.requestId ?? undefined
        },
        artist: { subPage: 'artist', pageId: comment.artistId ?? undefined },
        collages: {
          subPage: 'collages',
          pageId: comment.collageId ?? undefined
        },
        communities: {
          subPage: 'communities',
          pageId: comment.communityId ?? undefined
        },
        contributions: {
          subPage: 'contributions',
          pageId: comment.contributionId ?? undefined
        }
      };
      const subTarget = subPageMap[comment.page as CommentPage];

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

    res.json({ ...updated, bodyHtml: await renderSiteBBCode(updated.body) });
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
