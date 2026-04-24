import express from 'express';
import { authHandler } from '../../../modules/asyncHandler';
import { castVote } from '../../../modules/forum';
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
    const result = await castVote(
      forumPollId,
      req.user.id,
      req.user.userRankLevel,
      vote
    );
    if (!result.ok) {
      if (result.reason === 'not_found')
        return res.status(404).json({ msg: 'Poll not found' });
      if (result.reason === 'insufficient_class')
        return res
          .status(403)
          .json({ msg: 'Insufficient class to read this forum' });
      if (result.reason === 'closed')
        return res.status(403).json({ msg: 'Poll is closed' });
      return res.status(400).json({ msg: 'Invalid poll vote' });
    }
    res.json(result.vote);
  })
);

export default router;
