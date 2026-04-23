import express, { Request, Response } from 'express';
import { CommentPage } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { isModerator } from '../../middleware/permissions';
import { validate } from '../../middleware/validate';
import { sanitizeHtml } from '../../lib/sanitize';
import {
  commentQuerySchema,
  createCommentSchema,
  updateCommentSchema,
  type CommentQueryInput,
  type CreateCommentInput,
  type UpdateCommentInput
} from '../../schemas/comment';

const router = express.Router();

// GET /api/comments
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const parsedQuery = commentQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ errors: parsedQuery.error.flatten().fieldErrors });
    }

    const { page, pageId } = parsedQuery.data as CommentQueryInput;
    const where: Record<string, unknown> = {};
    if (page) where.page = page as CommentPage;
    if (page && pageId) {
      if (page === CommentPage.communities) where.communityId = pageId;
      else if (page === CommentPage.artist) where.artistId = pageId;
      else if (page === CommentPage.collages || page === CommentPage.requests)
        where.contributionId = pageId;
      else if (page === CommentPage.release) where.releaseId = pageId;
    }

    const comments = await prisma.comment.findMany({
      where: { ...where, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        author: { select: { id: true, username: true, avatar: true } },
        editedUser: { select: { id: true, username: true } }
      }
    });
    res.json(comments);
  })
);

// GET /api/comments/:id
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
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
  asyncHandler(async (req: Request, res: Response) => {
    const { page, body, communityId, contributionId, artistId, releaseId } =
      req.body as CreateCommentInput;

    const comment = await prisma.comment.create({
      data: {
        page,
        body: sanitizeHtml(body),
        authorId: req.user!.id,
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
  validate(updateCommentSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { body } = req.body as UpdateCommentInput;

    const id = parseInt(req.params.id);
    const comment = await prisma.comment.findUnique({ where: { id } });
    if (!comment) return res.status(404).json({ msg: 'Comment not found' });
    if (comment.authorId !== req.user!.id)
      return res.status(403).json({ msg: 'Not authorized' });

    const updated = await prisma.comment.update({
      where: { id },
      data: {
        body: sanitizeHtml(body),
        editedUserId: req.user!.id,
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
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });

    const comment = await prisma.comment.findUnique({ where: { id } });
    if (!comment) return res.status(404).json({ msg: 'Comment not found' });

    const isOwner = comment.authorId === req.user!.id;
    if (!isOwner && !(await isModerator(req, res))) {
      return res.status(403).json({ msg: 'Not authorized' });
    }

    const isModAction = !isOwner;
    await prisma.$transaction([
      prisma.comment.update({ where: { id }, data: { deletedAt: new Date() } }),
      prisma.auditLog.create({
        data: {
          actorId: req.user!.id,
          action: isModAction ? 'comment.mod_delete' : 'comment.delete',
          targetType: 'Comment',
          targetId: id
        }
      })
    ]);
    res.json({ msg: 'Comment deleted' });
  })
);

export default router;
