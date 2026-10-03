import express from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { canAccessForumLevel } from '../../../lib/userRankAccess';
import { authHandler } from '../../../modules/asyncHandler';
import { createPoll, closePoll } from '../../../modules/forum';
import { requireAuth } from '../../../middleware/auth';
import {
  loadPermissions,
  hasPermission
} from '../../../middleware/permissions';
import { validate, validateParams } from '../../../middleware/validate';
import { pollSchema } from '../../../schemas/poll';

const router = express.Router();
const pollBody = validate(pollSchema);
const topicIdParamsSchema = z.object({
  topicId: z.coerce.number().int().positive()
});
const topicIdParams = validateParams(topicIdParamsSchema);
const pollIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});
const pollIdParams = validateParams(pollIdParamsSchema);

// GET /api/forums/polls/:topicId
router.get(
  '/:topicId',
  requireAuth,
  topicIdParams,
  authHandler(async (req, res) => {
    const { topicId: forumTopicId } = topicIdParams.read(res);

    const poll = await prisma.forumPoll.findUnique({
      where: { forumTopicId },
      include: {
        votes: true,
        forumTopic: {
          select: {
            forumId: true,
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

    if (
      !canAccessForumLevel(
        req.user,
        poll.forumTopic?.forumId ?? 0,
        poll.forumTopic?.forum.minClassRead
      )
    ) {
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
  pollBody,
  authHandler(async (req, res) => {
    const { forumTopicId, question, answers } = pollBody.read(res);

    const topic = await prisma.forumTopic.findUnique({
      where: { id: forumTopicId },
      select: { id: true, authorId: true, deletedAt: true }
    });
    if (!topic || topic.deletedAt)
      return res.status(404).json({ msg: 'Topic not found' });

    const isOwner = topic.authorId === req.user.id;
    if (
      !isOwner &&
      !hasPermission(await loadPermissions(req, res), 'forums_moderate')
    ) {
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
  pollIdParams,
  authHandler(async (req, res) => {
    const { id } = pollIdParams.read(res);

    const poll = await prisma.forumPoll.findUnique({
      where: { id },
      include: { forumTopic: { select: { authorId: true } } }
    });
    if (!poll) return res.status(404).json({ msg: 'Poll not found' });

    const isOwner = poll.forumTopic?.authorId === req.user.id;
    if (
      !isOwner &&
      !hasPermission(await loadPermissions(req, res), 'forums_moderate')
    ) {
      return res.status(403).json({ msg: 'Not authorized' });
    }

    const updated = await closePoll(id);
    res.json(updated);
  })
);

export default router;
