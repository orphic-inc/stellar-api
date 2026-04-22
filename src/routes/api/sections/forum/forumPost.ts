import express, { Request, Response } from 'express';
import { check, validationResult } from 'express-validator';
import { prisma } from '../../../../lib/prisma';
import { asyncHandler } from '../../../../modules/asyncHandler';
import { requireAuth } from '../../../../middleware/auth';

const router = express.Router({ mergeParams: true });

// GET /api/forums/:forumId/topics/:forumTopicId/posts
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const forumTopicId = parseInt(req.params.forumTopicId);
    if (isNaN(forumTopicId)) return res.status(400).json({ msg: 'Invalid topic id' });
    const posts = await prisma.forumPost.findMany({
      where: { forumTopicId },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, username: true, avatar: true } } }
    });
    res.json(posts);
  })
);

// GET /api/forums/:forumId/topics/:forumTopicId/posts/:id
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
    const post = await prisma.forumPost.findUnique({
      where: { id },
      include: { author: { select: { id: true, username: true, avatar: true } } }
    });
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    res.json(post);
  })
);

// POST /api/forums/:forumId/topics/:forumTopicId/posts
router.post(
  '/',
  requireAuth,
  [check('body', 'Body is required').not().isEmpty()],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const forumId = parseInt(req.params.forumId);
    const forumTopicId = parseInt(req.params.forumTopicId);

    const [forum, topic] = await Promise.all([
      prisma.forum.findUnique({ where: { id: forumId } }),
      prisma.forumTopic.findUnique({ where: { id: forumTopicId } })
    ]);
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });
    if (!topic) return res.status(404).json({ msg: 'Forum topic not found' });
    if (topic.isLocked) return res.status(403).json({ msg: 'Topic is locked' });

    const [post] = await prisma.$transaction(async (tx) => {
      const post = await tx.forumPost.create({
        data: { forumTopicId, authorId: req.user!.id, body: req.body.body }
      });
      await tx.forumTopic.update({
        where: { id: forumTopicId },
        data: { lastPostId: post.id, numPosts: { increment: 1 } }
      });
      await tx.forum.update({
        where: { id: forumId },
        data: { lastTopicId: forumTopicId, numPosts: { increment: 1 } }
      });
      return [post];
    });

    res.status(201).json(post);
  })
);

// PUT /api/forums/:forumId/topics/:forumTopicId/posts/:id
router.put(
  '/:id',
  requireAuth,
  [check('body', 'Body is required').not().isEmpty()],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const id = parseInt(req.params.id);
    const post = await prisma.forumPost.findUnique({ where: { id } });
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    if (post.authorId !== req.user!.id) return res.status(403).json({ msg: 'Not authorized' });

    const edits = (post.edits as Array<Record<string, unknown>>) ?? [];
    edits.push({ userId: req.user!.id, time: new Date().toISOString() });

    const updated = await prisma.forumPost.update({
      where: { id },
      data: { body: req.body.body, edits: edits as never }
    });
    res.json(updated);
  })
);

// DELETE /api/forums/:forumId/topics/:forumTopicId/posts/:id
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    const post = await prisma.forumPost.findUnique({ where: { id } });
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    if (post.authorId !== req.user!.id) return res.status(403).json({ msg: 'Not authorized' });

    await prisma.$transaction([
      prisma.forumPost.delete({ where: { id } }),
      prisma.forumTopic.update({
        where: { id: post.forumTopicId },
        data: { numPosts: { decrement: 1 } }
      })
    ]);
    res.json({ msg: 'Forum post removed' });
  })
);

export default router;
