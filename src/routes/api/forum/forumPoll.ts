import express from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { authHandler } from '../../../modules/asyncHandler';
import { createPoll, closePoll } from '../../../modules/forum';
import { requireAuth } from '../../../middleware/auth';
import { isModerator } from '../../../middleware/permissions';
import {
  parsedBody,
  validate,
  validateParams,
  parsedParams
} from '../../../middleware/validate';
import { pollSchema, type PollInput } from '../../../schemas/poll';

const router = express.Router();
const topicIdParamsSchema = z.object({
  topicId: z.coerce.number().int().positive()
});
const pollIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

// GET /api/forums/polls/:topicId
router.get(
  '/:topicId',
  requireAuth,
  validateParams(topicIdParamsSchema),
  authHandler(async (req, res) => {
    const { topicId: forumTopicId } = parsedParams<{
      topicId: number;
    }>(res);

    const poll = await prisma.forumPoll.findUnique({
      where: { forumTopicId },
      include: {
        votes: true,
        forumTopic: {
          select: {
            deletedAt: true,
            forum: { select: { minClassRead: true } }
          }
        }
      }
    });
    if (!poll) return res.status(404).json({ msg: 'Poll not found' });

    if (poll.forumTopic?.deletedAt) {
      return res.status(404).json({ msg: 'Poll not found' });
    }

    if (req.user.userRankLevel < (poll.forumTopic?.forum.minClassRead ?? 0)) {
      return res
        .status(403)
        .json({ msg: 'Insufficient class to read this forum' });
    }

    res.json(poll);
  })
);

// POST /api/forums/polls — topic author or moderator only
router.post(
  '/',
  requireAuth,
  validate(pollSchema),
  authHandler(async (req, res) => {
    const { forumTopicId, question, answers } = parsedBody<PollInput>(res);

    const topic = await prisma.forumTopic.findUnique({
      where: { id: forumTopicId },
      select: { id: true, authorId: true, deletedAt: true }
    });
    if (!topic || topic.deletedAt)
      return res.status(404).json({ msg: 'Topic not found' });

    const isOwner = topic.authorId === req.user.id;
    if (!isOwner && !(await isModerator(req, res))) {
      return res.status(403).json({ msg: 'Not authorized' });
    }

    const poll = await createPoll(forumTopicId, question, answers);
    res.status(201).json(poll);
  })
);

// PUT /api/forums/polls/:id/close — moderator only
router.put(
  '/:id/close',
  requireAuth,
  validateParams(pollIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);

    const poll = await prisma.forumPoll.findUnique({
      where: { id },
      include: { forumTopic: { select: { authorId: true } } }
    });
    if (!poll) return res.status(404).json({ msg: 'Poll not found' });

    const isOwner = poll.forumTopic?.authorId === req.user.id;
    if (!isOwner && !(await isModerator(req, res))) {
      return res.status(403).json({ msg: 'Not authorized' });
    }

    const updated = await closePoll(id);
    res.json(updated);
  })
);

export default router;
