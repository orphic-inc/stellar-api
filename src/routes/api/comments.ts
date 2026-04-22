import express, { Request, Response } from 'express';
import { check, validationResult } from 'express-validator';
import { CommentPage } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';

const router = express.Router();

// GET /api/comments
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { page, pageId } = req.query;
    const where: Record<string, unknown> = {};
    if (page) where.page = page as CommentPage;
    if (pageId) where.communityId = parseInt(pageId as string);
    const comments = await prisma.comment.findMany({
      where,
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
      include: { author: { select: { id: true, username: true, avatar: true } } }
    });
    if (!comment) return res.status(404).json({ msg: 'Comment not found' });
    res.json(comment);
  })
);

// POST /api/comments
router.post(
  '/',
  requireAuth,
  [
    check('page', 'Page is required').not().isEmpty(),
    check('body', 'Body is required').not().isEmpty()
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { page, body, communityId, contributionId, artistId } = req.body as {
      page: CommentPage; body: string;
      communityId?: number; contributionId?: number; artistId?: number;
    };

    const comment = await prisma.comment.create({
      data: {
        page,
        body,
        authorId: req.user!.id,
        ...(communityId && { communityId }),
        ...(contributionId && { contributionId }),
        ...(artistId && { artistId })
      },
      include: { author: { select: { id: true, username: true, avatar: true } } }
    });
    res.status(201).json(comment);
  })
);

// PUT /api/comments/:id
router.put(
  '/:id',
  requireAuth,
  [check('body', 'Body is required').not().isEmpty()],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const id = parseInt(req.params.id);
    const comment = await prisma.comment.findUnique({ where: { id } });
    if (!comment) return res.status(404).json({ msg: 'Comment not found' });
    if (comment.authorId !== req.user!.id) return res.status(403).json({ msg: 'Not authorized' });

    const updated = await prisma.comment.update({
      where: { id },
      data: { body: req.body.body, editedUserId: req.user!.id, editedAt: new Date() }
    });
    res.json(updated);
  })
);

export default router;
