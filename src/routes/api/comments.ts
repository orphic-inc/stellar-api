import express, { Request, Response } from 'express';
import { CommentPage, SubscriptionPage } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { emitNotifications } from '../../lib/notifications';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { isModerator } from '../../middleware/permissions';
import {
  parsedBody,
  validate,
  validateParams,
  validateQuery,
  parsedParams,
  parsedQuery
} from '../../middleware/validate';
import { sanitizeHtml } from '../../lib/sanitize';
import { parsePage, paginatedResponse } from '../../lib/pagination';
import {
  commentQuerySchema,
  createCommentSchema,
  updateCommentSchema,
  type CommentQueryInput,
  type CreateCommentInput,
  type UpdateCommentInput
} from '../../schemas/comment';
import { deleteComment } from '../../modules/comment';

const router = express.Router();
const commentIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

// GET /api/comments
router.get(
  '/',
  validateQuery(commentQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { page, pageId } = parsedQuery<CommentQueryInput>(res);
    const where: Record<string, unknown> = {};
    if (page) where.page = page as CommentPage;
    if (page && pageId) {
      if (page === CommentPage.communities) where.communityId = pageId;
      else if (page === CommentPage.artist) where.artistId = pageId;
      else if (page === CommentPage.collages) where.collageId = pageId;
      else if (page === CommentPage.contributions)
        where.contributionId = pageId;
      else if (page === CommentPage.requests) where.requestId = pageId;
      else if (page === CommentPage.release) where.releaseId = pageId;
    }

    const pg = parsePage(req);
    const [comments, total] = await Promise.all([
      prisma.comment.findMany({
        where: { ...where, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        skip: pg.skip,
        take: pg.limit,
        include: {
          author: { select: { id: true, username: true, avatar: true } },
          editedUser: { select: { id: true, username: true } }
        }
      }),
      prisma.comment.count({ where: { ...where, deletedAt: null } })
    ]);
    paginatedResponse(res, comments, total, pg);
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
        author: { select: { id: true, username: true, avatar: true } }
      }
    });
    if (!comment) return res.status(404).json({ msg: 'Comment not found' });
    res.json(comment);
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
          author: { select: { id: true, username: true, avatar: true } }
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
      }

      return created;
    });

    res.status(201).json(comment);
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

    const updated = await prisma.comment.update({
      where: { id },
      data: {
        body: sanitizeHtml(body),
        editedUserId: req.user.id,
        editedAt: new Date()
      }
    });
    res.json(updated);
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
    if (!isOwner && !(await isModerator(req, res))) {
      return res.status(403).json({ msg: 'Not authorized' });
    }

    await deleteComment(id, req.user.id, !isOwner);
    res.status(204).send();
  })
);

export default router;
