import express, { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { postSchema, postCommentSchema } from '../../schemas/install';

const router = express.Router();

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
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
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
    const { title, text, category, tags } = req.body as {
      title: string;
      text: string;
      category: string;
      tags?: string[];
    };

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
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
    const post = await prisma.post.findUnique({ where: { id } });
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    if (post.userId !== req.user!.id)
      return res.status(401).json({ msg: 'Not authorized' });
    await prisma.post.delete({ where: { id } });
    res.json({ msg: 'Post removed' });
  })
);

// POST /api/posts/comment/:id
router.post(
  '/comment/:id',
  requireAuth,
  validate(postCommentSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const post = await prisma.post.findUnique({ where: { id } });
    if (!post) return res.status(404).json({ msg: 'Post not found' });

    const comments = (post.comments as Array<Record<string, unknown>>) ?? [];
    comments.unshift({
      userId: req.user!.id,
      text: req.body.text,
      date: new Date().toISOString()
    });

    const updated = await prisma.post.update({
      where: { id },
      data: { comments: comments as never }
    });
    res.json(updated.comments);
  })
);

// DELETE /api/posts/comment/:id/:commentIdx
router.delete(
  '/comment/:id/:commentIdx',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const idx = parseInt(req.params.commentIdx);
    const post = await prisma.post.findUnique({ where: { id } });
    if (!post) return res.status(404).json({ msg: 'Post not found' });

    const comments = (post.comments as Array<Record<string, unknown>>) ?? [];
    if (idx < 0 || idx >= comments.length)
      return res.status(404).json({ msg: 'Comment not found' });
    if (comments[idx].userId !== req.user!.id)
      return res.status(401).json({ msg: 'Not authorized' });

    comments.splice(idx, 1);
    const updated = await prisma.post.update({
      where: { id },
      data: { comments: comments as never }
    });
    res.json(updated.comments);
  })
);

export default router;
