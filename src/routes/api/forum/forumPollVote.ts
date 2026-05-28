import express from 'express';
import { authHandler } from '../../../modules/asyncHandler';
import {
  voteTopicPoll,
  type TopicSessionActor
} from '../../../modules/topicSession';
import { requireAuth } from '../../../middleware/auth';
import {
  loadPermissions,
  hasPermission
} from '../../../middleware/permissions';
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
    const actor: TopicSessionActor = {
      actorId: req.user.id,
      userRankLevel: req.user.userRankLevel,
      permittedForumIds: req.user.permittedForumIds,
      canModerateForums: hasPermission(
        await loadPermissions(req, res),
        'forums_moderate'
      )
    };
    const result = await voteTopicPoll(forumPollId, actor, vote);
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
