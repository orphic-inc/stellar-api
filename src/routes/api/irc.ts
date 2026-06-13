import express from 'express';
import { asyncHandler } from '../../modules/asyncHandler';
import { requireBotToken } from '../../middleware/sharedSecret';
import { validate, parsedBody } from '../../middleware/validate';
import { ircActivitySchema, type IrcActivityInput } from '../../schemas/irc';
import { upsertActivity, toUtcDay } from '../../modules/ircActivity';

const router = express.Router();

// POST /api/irc/activity — the bot upserts per-channel daily message counts
// (ADR-0012). Scoped-token only (Golden Rule 5); never session/user auth.
// Messages only — the endpoint accepts counts, never message content.
router.post(
  '/activity',
  requireBotToken,
  validate(ircActivitySchema),
  asyncHandler(async (_req, res) => {
    const { day, entries } = parsedBody<IrcActivityInput>(res);
    const result = await upsertActivity(toUtcDay(day), entries);
    res.json(result);
  })
);

export default router;
