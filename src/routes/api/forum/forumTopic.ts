import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { asyncHandler, authHandler } from '../../../modules/asyncHandler';
import { requireAuth } from '../../../middleware/auth';
import { isModerator } from '../../../middleware/permissions';
import { validate, validateParams } from '../../../middleware/validate';
import { writeLimiter } from '../../../middleware/rateLimiter';
import {
  createTopicSchema,
  updateTopicSchema,
  type CreateTopicInput
} from '../../../schemas/forum';
import { audit } from '../../../lib/audit';
import { parsePage, paginatedResponse } from '../../../lib/pagination';
import { sanitizeHtml, sanitizePlain } from '../../../lib/sanitize';
import forumPostRouter from './forumPost';

const router = express.Router({ mergeParams: true });
const forumIdParamsSchema = z.object({
  forumId: z.coerce.number().int().positive()
});
const forumTopicParamsSchema = z.object({
  forumId: z.coerce.number().int().positive(),
  forumTopicId: z.coerce.number().int().positive()
});

router.use('/:forumTopicId/posts', forumPostRouter);

// GET /api/forums/:forumId/topics
router.get(
  '/',
  requireAuth,
  validateParams(forumIdParamsSchema),
  authHandler(async (req, res) => {
    const { forumId } = req.params as unknown as { forumId: number };

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
    const [topics, total] = await Promise.all([
      prisma.forumTopic.findMany({
        where: { forumId, deletedAt: null },
        orderBy: [{ isSticky: 'desc' }, { updatedAt: 'desc' }],
        skip: pg.skip,
        take: pg.limit,
        include: {
          author: { select: { id: true, username: true } },
          lastPost: {
            include: { author: { select: { id: true, username: true } } }
          }
        }
      }),
      prisma.forumTopic.count({ where: { forumId, deletedAt: null } })
    ]);
    paginatedResponse(res, topics, total, pg);
  })
);

// GET /api/forums/:forumId/topics/:forumTopicId
router.get(
  '/:forumTopicId',
  requireAuth,
  validateParams(forumTopicParamsSchema),
  authHandler(async (req, res) => {
    const { forumId, forumTopicId: id } = req.params as unknown as {
      forumId: number;
      forumTopicId: number;
    };
    const [forum, topic] = await Promise.all([
      prisma.forum.findUnique({
        where: { id: forumId },
        select: { minClassRead: true }
      }),
      prisma.forumTopic.findFirst({
        where: { id, forumId, deletedAt: null },
        include: {
          author: { select: { id: true, username: true, avatar: true } },
          notes: {
            include: { author: { select: { id: true, username: true } } }
          }
        }
      })
    ]);
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });
    if (req.user.userRankLevel < (forum.minClassRead ?? 0)) {
      return res
        .status(403)
        .json({ msg: 'Insufficient class to read this forum' });
    }
    if (!topic) return res.status(404).json({ msg: 'Topic not found' });
    res.json(topic);
  })
);

// POST /api/forums/:forumId/topics
router.post(
  '/',
  requireAuth,
  writeLimiter,
  validateParams(forumIdParamsSchema),
  validate(createTopicSchema),
  authHandler(async (req, res) => {
    const { forumId } = req.params as unknown as { forumId: number };
    const forum = await prisma.forum.findUnique({
      where: { id: forumId },
      select: { id: true, minClassWrite: true, minClassCreate: true }
    });
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });
    if (req.user.userRankLevel < (forum.minClassCreate ?? 0)) {
      return res
        .status(403)
        .json({ msg: 'Insufficient class to create topics in this forum' });
    }

    const { title, body, question, answers } = req.body as CreateTopicInput;

    const topic = await prisma.$transaction(async (tx) => {
      const topic = await tx.forumTopic.create({
        data: { title, forumId, authorId: req.user.id }
      });

      const post = await tx.forumPost.create({
        data: {
          forumTopicId: topic.id,
          authorId: req.user.id,
          body: sanitizeHtml(body)
        }
      });

      await tx.forumTopic.update({
        where: { id: topic.id },
        data: { lastPostId: post.id, numPosts: 1 }
      });

      await tx.forum.update({
        where: { id: forumId },
        data: {
          lastTopicId: topic.id,
          numTopics: { increment: 1 },
          numPosts: { increment: 1 }
        }
      });

      if (question && answers) {
        await tx.forumPoll.create({
          data: {
            forumTopicId: topic.id,
            question: sanitizePlain(question),
            answers: sanitizePlain(answers)
          }
        });
      }

      return topic;
    });

    res.status(201).json(topic);
  })
);

// PUT /api/forums/:forumId/topics/:forumTopicId — author or moderator
router.put(
  '/:forumTopicId',
  requireAuth,
  validateParams(forumTopicParamsSchema),
  validate(updateTopicSchema),
  authHandler(async (req, res) => {
    const { forumId, forumTopicId: id } = req.params as unknown as {
      forumId: number;
      forumTopicId: number;
    };
    const topic = await prisma.forumTopic.findFirst({
      where: { id, forumId, deletedAt: null }
    });
    if (!topic) return res.status(404).json({ msg: 'Topic not found' });

    const isOwner = topic.authorId === req.user.id;
    if (!isOwner && !(await isModerator(req, res))) {
      return res.status(403).json({ msg: 'Not authorized' });
    }

    const { title, isLocked, isSticky } = req.body;
    const updated = await prisma.forumTopic.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(isLocked !== undefined && { isLocked }),
        ...(isSticky !== undefined && { isSticky })
      }
    });
    res.json(updated);
  })
);

// DELETE /api/forums/:forumId/topics/:forumTopicId — author or moderator
router.delete(
  '/:forumTopicId',
  requireAuth,
  validateParams(forumTopicParamsSchema),
  authHandler(async (req, res) => {
    const { forumId, forumTopicId: id } = req.params as unknown as {
      forumId: number;
      forumTopicId: number;
    };
    const topic = await prisma.forumTopic.findFirst({
      where: { id, forumId, deletedAt: null }
    });
    if (!topic) return res.status(404).json({ msg: 'Topic not found' });

    const isOwner = topic.authorId === req.user.id;
    if (!isOwner && !(await isModerator(req, res))) {
      return res.status(403).json({ msg: 'Not authorized' });
    }

    const isModAction = !isOwner;

    const livePostCount = await prisma.forumPost.count({
      where: { forumTopicId: id, deletedAt: null }
    });

    await prisma.$transaction([
      prisma.forumTopic.update({
        where: { id },
        data: { deletedAt: new Date() }
      }),
      prisma.forum.update({
        where: { id: topic.forumId },
        data: {
          numTopics: { decrement: 1 },
          numPosts: { decrement: livePostCount }
        }
      }),
      prisma.auditLog.create({
        data: {
          actorId: req.user.id,
          action: isModAction ? 'topic.mod_delete' : 'topic.delete',
          targetType: 'ForumTopic',
          targetId: id
        }
      })
    ]);

    res.json({ msg: 'Topic removed' });
  })
);

export default router;
