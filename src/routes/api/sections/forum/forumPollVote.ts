import express, { Request, Response } from 'express';
import { prisma } from '../../../../lib/prisma';
import { asyncHandler } from '../../../../modules/asyncHandler';
import { requireAuth } from '../../../../middleware/auth';
import { validate } from '../../../../middleware/validate';
import { pollVoteSchema } from '../../../../schemas/install';

const router = express.Router();

// POST /api/forums/poll-votes
router.post(
  '/',
  requireAuth,
  validate(pollVoteSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { forumPollId, vote } = req.body as { forumPollId: number; vote: number };
    const userId = req.user!.id;

    const poll = await prisma.forumPoll.findUnique({ where: { id: forumPollId } });
    if (!poll) return res.status(404).json({ msg: 'Poll not found' });
    if (poll.closed) return res.status(403).json({ msg: 'Poll is closed' });

    const result = await prisma.forumPollVote.upsert({
      where: { forumPollId_userId: { forumPollId, userId } },
      create: { forumPollId, userId, vote },
      update: { vote }
    });
    res.json(result);
  })
);

export default router;
