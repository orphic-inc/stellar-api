import express, { Request, Response } from 'express';
import { prisma } from '../../../lib/prisma';
import { asyncHandler } from '../../../modules/asyncHandler';
import { requireAuth } from '../../../middleware/auth';
import { isModerator } from '../../../middleware/permissions';
import { validate } from '../../../middleware/validate';
import { pollSchema } from '../../../schemas/poll';

const router = express.Router();

// GET /api/forums/polls/:topicId
router.get(
  '/:topicId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const forumTopicId = parseInt(req.params.topicId);
    if (isNaN(forumTopicId))
      return res.status(400).json({ msg: 'Invalid topic id' });

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

    if (req.user!.userRankLevel < (poll.forumTopic?.forum.minClassRead ?? 0)) {
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
  asyncHandler(async (req: Request, res: Response) => {
    const { forumTopicId, question, answers } = req.body as {
      forumTopicId: number;
      question: string;
      answers: string;
    };

    const topic = await prisma.forumTopic.findUnique({
      where: { id: forumTopicId },
      select: { id: true, authorId: true, deletedAt: true }
    });
    if (!topic || topic.deletedAt)
      return res.status(404).json({ msg: 'Topic not found' });

    const isOwner = topic.authorId === req.user!.id;
    if (!isOwner && !(await isModerator(req, res))) {
      return res.status(403).json({ msg: 'Not authorized' });
    }

    const poll = await prisma.forumPoll.create({
      data: { forumTopicId, question, answers }
    });
    res.status(201).json(poll);
  })
);

// PUT /api/forums/polls/:id/close — moderator only
router.put(
  '/:id/close',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });

    const poll = await prisma.forumPoll.findUnique({
      where: { id },
      include: { forumTopic: { select: { authorId: true } } }
    });
    if (!poll) return res.status(404).json({ msg: 'Poll not found' });

    const isOwner = poll.forumTopic?.authorId === req.user!.id;
    if (!isOwner && !(await isModerator(req, res))) {
      return res.status(403).json({ msg: 'Not authorized' });
    }

    const updated = await prisma.forumPoll.update({
      where: { id },
      data: { closed: true }
    });
    res.json(updated);
  })
);

export default router;
