import express, { Request, Response } from 'express';
import { prisma } from '../../../../lib/prisma';
import { asyncHandler } from '../../../../modules/asyncHandler';
import { requireAuth } from '../../../../middleware/auth';
import { validate } from '../../../../middleware/validate';
import { pollSchema } from '../../../../schemas/poll';

const router = express.Router();

// GET /api/forums/polls/:topicId
router.get(
  '/:topicId',
  asyncHandler(async (req: Request, res: Response) => {
    const forumTopicId = parseInt(req.params.topicId);
    if (isNaN(forumTopicId))
      return res.status(400).json({ msg: 'Invalid topic id' });
    const poll = await prisma.forumPoll.findUnique({
      where: { forumTopicId },
      include: { votes: true }
    });
    if (!poll) return res.status(404).json({ msg: 'Poll not found' });
    res.json(poll);
  })
);

// POST /api/forums/polls
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
    const poll = await prisma.forumPoll.create({
      data: { forumTopicId, question, answers }
    });
    res.status(201).json(poll);
  })
);

// PUT /api/forums/polls/:id/close
router.put(
  '/:id/close',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ msg: 'Invalid id' });
    const poll = await prisma.forumPoll.update({
      where: { id },
      data: { closed: true }
    });
    res.json(poll);
  })
);

export default router;
