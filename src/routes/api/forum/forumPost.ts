import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { asyncHandler, authHandler } from '../../../modules/asyncHandler';
import { requireAuth } from '../../../middleware/auth';
import { isModerator } from '../../../middleware/permissions';
import { validate, validateParams } from '../../../middleware/validate';
import { writeLimiter } from '../../../middleware/rateLimiter';
import {
  createPostSchema,
  updatePostSchema,
  type CreatePostInput,
  type UpdatePostInput
} from '../../../schemas/forum';
import { audit } from '../../../lib/audit';
import { appendToJsonArray } from '../../../lib/jsonHelpers';
import { parsePage, paginatedResponse } from '../../../lib/pagination';
import { sanitizeHtml } from '../../../lib/sanitize';

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

// GET /api/forums/:forumId/topics/:forumTopicId/posts
router.get(
  '/',
  requireAuth,
  validateParams(forumTopicParamsSchema),
  authHandler(async (req, res) => {
    const { forumId, forumTopicId } = req.params as unknown as {
      forumId: number;
      forumTopicId: number;
    };

    const forum = await prisma.forum.findUnique({
      where: { id: forumId },
      select: { minClassRead: true }
    });
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });
    if (req.user.userRankLevel < (forum.minClassRead ?? 0)) {
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
        include: {
          author: { select: { id: true, username: true, avatar: true } }
        }
      }),
      prisma.forumPost.count({
        where: {
          forumTopicId,
          deletedAt: null,
          forumTopic: { forumId, deletedAt: null }
        }
      })
    ]);
    paginatedResponse(res, posts, total, pg);
  })
);

// GET /api/forums/:forumId/topics/:forumTopicId/posts/:id
router.get(
  '/:id',
  requireAuth,
  validateParams(forumPostParamsSchema),
  authHandler(async (req, res) => {
    const { forumId, forumTopicId, id } = req.params as unknown as {
      forumId: number;
      forumTopicId: number;
      id: number;
    };

    const forum = await prisma.forum.findUnique({
      where: { id: forumId },
      select: { minClassRead: true }
    });
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });
    if (req.user.userRankLevel < (forum.minClassRead ?? 0)) {
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
      include: {
        author: { select: { id: true, username: true, avatar: true } }
      }
    });
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    res.json(post);
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
    const { forumId, forumTopicId } = req.params as unknown as {
      forumId: number;
      forumTopicId: number;
    };

    const { body } = req.body as CreatePostInput;

    const [forum, topic] = await Promise.all([
      prisma.forum.findUnique({ where: { id: forumId } }),
      prisma.forumTopic.findUnique({ where: { id: forumTopicId } })
    ]);
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });
    if (!topic) return res.status(404).json({ msg: 'Forum topic not found' });
    if (topic.forumId !== forumId) {
      return res.status(404).json({ msg: 'Forum topic not found' });
    }
    if (topic.isLocked) return res.status(403).json({ msg: 'Topic is locked' });

    const [post] = await prisma.$transaction(async (tx) => {
      const post = await tx.forumPost.create({
        data: {
          forumTopicId,
          authorId: req.user.id,
          body: sanitizeHtml(body)
        }
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

// PUT /api/forums/:forumId/topics/:forumTopicId/posts/:id — author only
router.put(
  '/:id',
  requireAuth,
  validateParams(forumPostParamsSchema),
  validate(updatePostSchema),
  authHandler(async (req, res) => {
    const { forumId, forumTopicId, id } = req.params as unknown as {
      forumId: number;
      forumTopicId: number;
      id: number;
    };
    const { body } = req.body as UpdatePostInput;

    const post = await prisma.forumPost.findFirst({
      where: {
        id,
        forumTopicId,
        deletedAt: null,
        forumTopic: { forumId, deletedAt: null }
      }
    });
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    if (post.authorId !== req.user.id)
      return res.status(403).json({ msg: 'Not authorized' });

    const updated = await prisma.forumPost.update({
      where: { id },
      data: {
        body: sanitizeHtml(body),
        edits: appendToJsonArray(post.edits, {
          userId: req.user.id,
          time: new Date().toISOString(),
          previousBody: post.body
        })
      }
    });
    res.json(updated);
  })
);

// DELETE /api/forums/:forumId/topics/:forumTopicId/posts/:id — author or moderator
router.delete(
  '/:id',
  requireAuth,
  validateParams(forumPostParamsSchema),
  authHandler(async (req, res) => {
    const { forumId, forumTopicId, id } = req.params as unknown as {
      forumId: number;
      forumTopicId: number;
      id: number;
    };
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

    const isModAction = !isOwner;

    await prisma.$transaction([
      prisma.forumPost.update({
        where: { id },
        data: { deletedAt: new Date() }
      }),
      prisma.forumTopic.update({
        where: { id: post.forumTopicId },
        data: { numPosts: { decrement: 1 } }
      }),
      prisma.forum.update({
        where: { id: forumId },
        data: { numPosts: { decrement: 1 } }
      }),
      prisma.auditLog.create({
        data: {
          actorId: req.user.id,
          action: isModAction ? 'post.mod_delete' : 'post.delete',
          targetType: 'ForumPost',
          targetId: id
        }
      })
    ]);
    res.json({ msg: 'Forum post removed' });
  })
);

export default router;
