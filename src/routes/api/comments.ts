import express, { Request, Response } from 'express';
import { CommentPage } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
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
      else if (page === CommentPage.collages || page === CommentPage.requests)
        where.contributionId = pageId;
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
    const { page, body, communityId, contributionId, artistId, releaseId } =
      parsedBody<CreateCommentInput>(res);

    const comment = await prisma.comment.create({
      data: {
        page,
        body: sanitizeHtml(body),
        authorId: req.user.id,
        ...(communityId && { communityId }),
        ...(contributionId && { contributionId }),
        ...(artistId && { artistId }),
        ...(releaseId && { releaseId })
      },
      include: {
        author: { select: { id: true, username: true, avatar: true } }
      }
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

    const isModAction = !isOwner;
    await prisma.$transaction([
      prisma.comment.update({ where: { id }, data: { deletedAt: new Date() } }),
      prisma.auditLog.create({
        data: {
          actorId: req.user.id,
          action: isModAction ? 'comment.mod_delete' : 'comment.delete',
          targetType: 'Comment',
          targetId: id
        }
      })
    ]);
    res.status(204).send();
  })
);

export default router;
