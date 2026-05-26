import express from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { authHandler } from '../../../modules/asyncHandler';
import { createPost, updatePost, deletePost } from '../../../modules/forum';
import { requireAuth } from '../../../middleware/auth';
import { isModerator } from '../../../middleware/permissions';
import {
  parsedBody,
  validate,
  validateParams,
  parsedParams
} from '../../../middleware/validate';
import { writeLimiter } from '../../../middleware/rateLimiter';
import {
  createPostSchema,
  updatePostSchema,
  type CreatePostInput,
  type UpdatePostInput
} from '../../../schemas/forum';
import { parsePage, paginatedResponse } from '../../../lib/pagination';
import { canAccessForumLevel } from '../../../lib/userRankAccess';

const router = express.Router({ mergeParams: true });
const forumTopicParamsSchema = z.object({
  forumId: z.coerce.number().int().positive(),
  forumTopicId: z.coerce.number().int().positive()
});
const forumPostParamsSchema = z.object({
  forumId: z.coerce.number().int().positive(),
  forumTopicId: z.coerce.number().int().positive(),
  id: z.coerce.number().int().positive()
});

const publicPostInclude = {
  author: { select: { id: true, username: true, avatar: true } },
  edits: {
    orderBy: { editedAt: 'desc' as const },
    take: 1,
    select: {
      id: true,
      forumPostId: true,
      editorId: true,
      editedAt: true,
      editor: { select: { id: true, username: true } }
    }
  }
};

const editHistoryInclude = {
  edits: {
    orderBy: { editedAt: 'desc' as const },
    include: { editor: { select: { id: true, username: true } } }
  }
};

const serializeForumPost = <
  T extends {
    edits?: Array<{
      id: number;
      forumPostId: number;
      editorId: number;
      editedAt: Date;
      editor?: { id: number; username: string } | null;
    }>;
  }
>(
  post: T
) => ({
  ...post,
  ...(post.edits?.[0] ? { lastEdit: post.edits[0] } : {}),
  edits: undefined
});

// GET /api/forums/:forumId/topics/:forumTopicId/posts
router.get(
  '/',
  requireAuth,
  validateParams(forumTopicParamsSchema),
  authHandler(async (req, res) => {
    const { forumId, forumTopicId } = parsedParams<{
      forumId: number;
      forumTopicId: number;
    }>(res);

    const forum = await prisma.forum.findUnique({
      where: { id: forumId },
      select: { minClassRead: true }
    });
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });
    if (!canAccessForumLevel(req.user, forumId, forum.minClassRead)) {
      return res
        .status(403)
        .json({ msg: 'Insufficient class to read this forum' });
    }

    const pg = parsePage(req);
    const [posts, total] = await Promise.all([
      prisma.forumPost.findMany({
        where: {
          forumTopicId,
          deletedAt: null,
          forumTopic: { forumId, deletedAt: null }
        },
        orderBy: { createdAt: 'asc' },
        skip: pg.skip,
        take: pg.limit,
        include: publicPostInclude
      }),
      prisma.forumPost.count({
        where: {
          forumTopicId,
          deletedAt: null,
          forumTopic: { forumId, deletedAt: null }
        }
      })
    ]);
    paginatedResponse(
      res,
      posts.map((post) => serializeForumPost(post)),
      total,
      pg
    );
  })
);

// GET /api/forums/:forumId/topics/:forumTopicId/posts/:id
router.get(
  '/:id',
  requireAuth,
  validateParams(forumPostParamsSchema),
  authHandler(async (req, res) => {
    const { forumId, forumTopicId, id } = parsedParams<{
      forumId: number;
      forumTopicId: number;
      id: number;
    }>(res);

    const forum = await prisma.forum.findUnique({
      where: { id: forumId },
      select: { minClassRead: true }
    });
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });
    if (!canAccessForumLevel(req.user, forumId, forum.minClassRead)) {
      return res
        .status(403)
        .json({ msg: 'Insufficient class to read this forum' });
    }

    const post = await prisma.forumPost.findFirst({
      where: {
        id,
        forumTopicId,
        deletedAt: null,
        forumTopic: { forumId, deletedAt: null }
      },
      include: publicPostInclude
    });
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    res.json(serializeForumPost(post));
  })
);

// GET /api/forums/:forumId/topics/:forumTopicId/posts/:id/edits — moderator only
router.get(
  '/:id/edits',
  requireAuth,
  validateParams(forumPostParamsSchema),
  authHandler(async (req, res) => {
    const { forumId, forumTopicId, id } = parsedParams<{
      forumId: number;
      forumTopicId: number;
      id: number;
    }>(res);

    const forum = await prisma.forum.findUnique({
      where: { id: forumId },
      select: { minClassRead: true }
    });
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });
    if (!canAccessForumLevel(req.user, forumId, forum.minClassRead)) {
      return res
        .status(403)
        .json({ msg: 'Insufficient class to read this forum' });
    }
    if (!(await isModerator(req, res))) {
      return res
        .status(403)
        .json({ msg: 'Insufficient permission to view edit history' });
    }

    const post = await prisma.forumPost.findFirst({
      where: {
        id,
        forumTopicId,
        deletedAt: null,
        forumTopic: { forumId, deletedAt: null }
      },
      include: editHistoryInclude
    });
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    res.json({ data: post.edits });
  })
);

// POST /api/forums/:forumId/topics/:forumTopicId/posts
router.post(
  '/',
  requireAuth,
  writeLimiter,
  validateParams(forumTopicParamsSchema),
  validate(createPostSchema),
  authHandler(async (req, res) => {
    const { forumId, forumTopicId } = parsedParams<{
      forumId: number;
      forumTopicId: number;
    }>(res);
    const { body } = parsedBody<CreatePostInput>(res);

    const [forum, topic] = await Promise.all([
      prisma.forum.findUnique({ where: { id: forumId } }),
      prisma.forumTopic.findUnique({ where: { id: forumTopicId } })
    ]);
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });
    if (!topic || topic.forumId !== forumId)
      return res.status(404).json({ msg: 'Forum topic not found' });
    if (topic.isLocked) return res.status(403).json({ msg: 'Topic is locked' });

    const post = await createPost(forumId, forumTopicId, req.user.id, body);
    res.status(201).json(post);
  })
);

// PUT /api/forums/:forumId/topics/:forumTopicId/posts/:id — author or moderator
router.put(
  '/:id',
  requireAuth,
  validateParams(forumPostParamsSchema),
  validate(updatePostSchema),
  authHandler(async (req, res) => {
    const { forumId, forumTopicId, id } = parsedParams<{
      forumId: number;
      forumTopicId: number;
      id: number;
    }>(res);
    const { body } = parsedBody<UpdatePostInput>(res);

    const post = await prisma.forumPost.findFirst({
      where: {
        id,
        forumTopicId,
        deletedAt: null,
        forumTopic: { forumId, deletedAt: null }
      }
    });
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    const isOwner = post.authorId === req.user.id;
    if (!isOwner && !(await isModerator(req, res)))
      return res.status(403).json({ msg: 'Not authorized' });

    await updatePost(id, req.user.id, post.body, body, forumTopicId);

    const updated = await prisma.forumPost.findFirst({
      where: {
        id,
        forumTopicId,
        deletedAt: null,
        forumTopic: { forumId, deletedAt: null }
      },
      include: publicPostInclude
    });
    if (!updated) return res.status(404).json({ msg: 'Post not found' });
    res.json(serializeForumPost(updated));
  })
);

// DELETE /api/forums/:forumId/topics/:forumTopicId/posts/:id — author or moderator
router.delete(
  '/:id',
  requireAuth,
  validateParams(forumPostParamsSchema),
  authHandler(async (req, res) => {
    const { forumId, forumTopicId, id } = parsedParams<{
      forumId: number;
      forumTopicId: number;
      id: number;
    }>(res);
    const post = await prisma.forumPost.findFirst({
      where: {
        id,
        forumTopicId,
        deletedAt: null,
        forumTopic: { forumId, deletedAt: null }
      }
    });
    if (!post) return res.status(404).json({ msg: 'Post not found' });

    const isOwner = post.authorId === req.user.id;
    if (!isOwner && !(await isModerator(req, res))) {
      return res.status(403).json({ msg: 'Not authorized' });
    }

    await deletePost(id, forumTopicId, forumId, req.user.id, !isOwner);
    res.status(204).send();
  })
);

export default router;
