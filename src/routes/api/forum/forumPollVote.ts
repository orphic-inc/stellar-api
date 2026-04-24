import express, { Request, Response } from 'express';
import { prisma } from '../../../lib/prisma';
import { authHandler } from '../../../modules/asyncHandler';
import { requireAuth } from '../../../middleware/auth';
import { validate, parsedBody } from '../../../middleware/validate';
import { pollVoteSchema, type PollVoteInput } from '../../../schemas/poll';

const router = express.Router();

// POST /api/forums/poll-votes
router.post(
  '/',
  requireAuth,
  validate(pollVoteSchema),
  authHandler(async (req, res) => {
    const { forumPollId, vote } = parsedBody<PollVoteInput>(res);
    const userId = req.user.id;

    const poll = await prisma.forumPoll.findUnique({
      where: { id: forumPollId },
      include: {
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
    if (poll.closed) return res.status(403).json({ msg: 'Poll is closed' });

    let answers: unknown;
    try {
      answers = JSON.parse(poll.answers);
    } catch {
      return res.status(500).json({ msg: 'Poll answers are invalid' });
    }

    if (!Array.isArray(answers) || vote >= answers.length) {
      return res.status(400).json({ msg: 'Invalid poll vote' });
    }

    const result = await prisma.forumPollVote.upsert({
      where: { forumPollId_userId: { forumPollId, userId } },
      create: { forumPollId, userId, vote },
      update: { vote }
    });
    res.json(result);
  })
);

export default router;
