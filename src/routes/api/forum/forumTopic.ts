import express from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { authHandler } from '../../../modules/asyncHandler';
import { createTopic, updateTopic, deleteTopic } from '../../../modules/forum';
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
  createTopicSchema,
  updateTopicSchema,
  type CreateTopicInput,
  type UpdateTopicInput
} from '../../../schemas/forum';
import { parsePage, paginatedResponse } from '../../../lib/pagination';
import { sanitizePlain } from '../../../lib/sanitize';
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
    const { forumId } = parsedParams<{ forumId: number }>(res);

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
    const { forumId, forumTopicId: id } = parsedParams<{
      forumId: number;
      forumTopicId: number;
    }>(res);
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
    const { forumId } = parsedParams<{ forumId: number }>(res);
    const forum = await prisma.forum.findUnique({
      where: { id: forumId },
      select: { id: true, minClassCreate: true }
    });
    if (!forum) return res.status(404).json({ msg: 'Forum not found' });
    if (req.user.userRankLevel < (forum.minClassCreate ?? 0)) {
      return res
        .status(403)
        .json({ msg: 'Insufficient class to create topics in this forum' });
    }

    const { title, body, question, answers } =
      parsedBody<CreateTopicInput>(res);
    const topic = await createTopic(forumId, req.user.id, {
      title: sanitizePlain(title),
      body,
      question,
      answers
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
    const { forumId, forumTopicId: id } = parsedParams<{
      forumId: number;
      forumTopicId: number;
    }>(res);
    const topic = await prisma.forumTopic.findFirst({
      where: { id, forumId, deletedAt: null }
    });
    if (!topic) return res.status(404).json({ msg: 'Topic not found' });

    const isOwner = topic.authorId === req.user.id;
    if (!isOwner && !(await isModerator(req, res))) {
      return res.status(403).json({ msg: 'Not authorized' });
    }

    const { title, isLocked, isSticky } = parsedBody<UpdateTopicInput>(res);
    const updated = await updateTopic(id, { title, isLocked, isSticky });
    res.json(updated);
  })
);

// DELETE /api/forums/:forumId/topics/:forumTopicId — author or moderator
router.delete(
  '/:forumTopicId',
  requireAuth,
  validateParams(forumTopicParamsSchema),
  authHandler(async (req, res) => {
    const { forumId, forumTopicId: id } = parsedParams<{
      forumId: number;
      forumTopicId: number;
    }>(res);
    const topic = await prisma.forumTopic.findFirst({
      where: { id, forumId, deletedAt: null }
    });
    if (!topic) return res.status(404).json({ msg: 'Topic not found' });

    const isOwner = topic.authorId === req.user.id;
    if (!isOwner && !(await isModerator(req, res))) {
      return res.status(403).json({ msg: 'Not authorized' });
    }

    await deleteTopic(id, topic.forumId, req.user.id, !isOwner);
    res.status(204).send();
  })
);

export default router;
