import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { validate, validateParams } from '../../middleware/validate';
import {
  appendToJsonArray,
  jsonObjectArray,
  removeFromJsonArrayAtIndex
} from '../../lib/jsonHelpers';
import {
  postSchema,
  postCommentSchema,
  type PostInput,
  type PostCommentInput
} from '../../schemas/post';

const router = express.Router();
const postIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});
const postCommentParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  commentIdx: z.coerce.number().int().min(0)
});

// GET /api/posts
router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const posts = await prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, username: true, avatar: true } } }
    });
    res.json(posts);
  })
);

// GET /api/posts/:id
router.get(
  '/:id',
  requireAuth,
  validateParams(postIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as unknown as { id: number };
    const post = await prisma.post.findUnique({
      where: { id },
      include: { user: { select: { id: true, username: true, avatar: true } } }
    });
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    res.json(post);
  })
);

// POST /api/posts
router.post(
  '/',
  requireAuth,
  validate(postSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { title, text, category, tags } = req.body as PostInput;

    const post = await prisma.post.create({
      data: { userId: req.user!.id, title, text, category, tags: tags ?? [] },
      include: { user: { select: { id: true, username: true, avatar: true } } }
    });
    res.status(201).json(post);
  })
);

// DELETE /api/posts/:id
router.delete(
  '/:id',
  requireAuth,
  validateParams(postIdParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as unknown as { id: number };
    const post = await prisma.post.findUnique({ where: { id } });
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    if (post.userId !== req.user!.id)
      return res.status(403).json({ msg: 'Not authorized' });
    await prisma.post.delete({ where: { id } });
    res.json({ msg: 'Post removed' });
  })
);

// POST /api/posts/comment/:id
router.post(
  '/comment/:id',
  requireAuth,
  validateParams(postIdParamsSchema),
  validate(postCommentSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as unknown as { id: number };
    const { text } = req.body as PostCommentInput;
    const post = await prisma.post.findUnique({ where: { id } });
    if (!post) return res.status(404).json({ msg: 'Post not found' });

    const updated = await prisma.post.update({
      where: { id },
      data: {
        comments: appendToJsonArray(post.comments, {
          userId: req.user!.id,
          text,
          date: new Date().toISOString()
        })
      }
    });
    res.json(updated.comments);
  })
);

// DELETE /api/posts/comment/:id/:commentIdx
router.delete(
  '/comment/:id/:commentIdx',
  requireAuth,
  validateParams(postCommentParamsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, commentIdx: idx } = req.params as unknown as {
      id: number;
      commentIdx: number;
    };
    const post = await prisma.post.findUnique({ where: { id } });
    if (!post) return res.status(404).json({ msg: 'Post not found' });

    const comments = jsonObjectArray(post.comments);
    if (idx < 0 || idx >= comments.length)
      return res.status(404).json({ msg: 'Comment not found' });
    if (comments[idx]?.userId !== req.user!.id)
      return res.status(403).json({ msg: 'Not authorized' });

    const updated = await prisma.post.update({
      where: { id },
      data: { comments: removeFromJsonArrayAtIndex(post.comments, idx) }
    });
    res.json(updated.comments);
  })
);

export default router;
