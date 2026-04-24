import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import {
  parsedBody,
  validate,
  validateParams,
  parsedParams
} from '../../middleware/validate';
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
  commentId: z.coerce.number().int().positive()
});

const postInclude = {
  user: { select: { id: true, username: true, avatar: true } },
  comments: {
    orderBy: { createdAt: 'asc' as const },
    include: { user: { select: { id: true, username: true, avatar: true } } }
  }
};

// GET /api/posts
router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const posts = await prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      include: postInclude
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
    const { id } = parsedParams<{ id: number }>(res);
    const post = await prisma.post.findUnique({
      where: { id },
      include: postInclude
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
  authHandler(async (req, res) => {
    const { title, text, category, tags } = parsedBody<PostInput>(res);
    const post = await prisma.post.create({
      data: { userId: req.user.id, title, text, category, tags: tags ?? [] },
      include: postInclude
    });
    res.status(201).json(post);
  })
);

// DELETE /api/posts/:id
router.delete(
  '/:id',
  requireAuth,
  validateParams(postIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const post = await prisma.post.findUnique({ where: { id } });
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    if (post.userId !== req.user.id)
      return res.status(403).json({ msg: 'Not authorized' });
    await prisma.post.delete({ where: { id } });
    res.status(204).send();
  })
);

// POST /api/posts/:id/comments
router.post(
  '/:id/comments',
  requireAuth,
  validateParams(postIdParamsSchema),
  validate(postCommentSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { text } = parsedBody<PostCommentInput>(res);
    const post = await prisma.post.findUnique({ where: { id } });
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    const comment = await prisma.postComment.create({
      data: { postId: id, userId: req.user.id, text },
      include: { user: { select: { id: true, username: true, avatar: true } } }
    });
    res.status(201).json(comment);
  })
);

// DELETE /api/posts/:id/comments/:commentId
router.delete(
  '/:id/comments/:commentId',
  requireAuth,
  validateParams(postCommentParamsSchema),
  authHandler(async (req, res) => {
    const { commentId } = parsedParams<{ id: number; commentId: number }>(res);
    const comment = await prisma.postComment.findUnique({
      where: { id: commentId }
    });
    if (!comment) return res.status(404).json({ msg: 'Comment not found' });
    if (comment.userId !== req.user.id)
      return res.status(403).json({ msg: 'Not authorized' });
    await prisma.postComment.delete({ where: { id: commentId } });
    res.status(204).send();
  })
);

export default router;
