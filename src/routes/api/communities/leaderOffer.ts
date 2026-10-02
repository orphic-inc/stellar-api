import express from 'express';
import { z } from 'zod';
import { authHandler } from '../../../modules/asyncHandler';
import {
  answerLeaderOffer,
  offerLeadership,
  withdrawLeaderOffer
} from '../../../modules/communityLeadership';
import { requireAuth } from '../../../middleware/auth';
import {
  parsedBody,
  parsedParams,
  validate,
  validateParams
} from '../../../middleware/validate';
import {
  leaderOfferSchema,
  type LeaderOfferInput
} from '../../../schemas/community';

/**
 * A community leader's handoff offer, mounted at
 * `/api/communities/:id/leader-offer` (#896, ADR-0053 §3–8). Each route is a
 * relationship edit whose outcome the request decides, so each answers `204`
 * (#711); the rules live in modules/communityLeadership.ts.
 */
const router = express.Router({ mergeParams: true });
const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

// POST /api/communities/:id/leader-offer — the leader offers leadership to a curator
router.post(
  '/',
  requireAuth,
  validateParams(paramsSchema),
  validate(leaderOfferSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { userId } = parsedBody<LeaderOfferInput>(res);
    await offerLeadership(id, req.user.id, userId);
    res.status(204).send();
  })
);

// DELETE /api/communities/:id/leader-offer — the leader withdraws the offer
router.delete(
  '/',
  requireAuth,
  validateParams(paramsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    await withdrawLeaderOffer(id, req.user.id);
    res.status(204).send();
  })
);

// POST /api/communities/:id/leader-offer/accept — the successor takes leadership
router.post(
  '/accept',
  requireAuth,
  validateParams(paramsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    await answerLeaderOffer(id, req.user.id, true);
    res.status(204).send();
  })
);

// POST /api/communities/:id/leader-offer/decline — the successor declines
router.post(
  '/decline',
  requireAuth,
  validateParams(paramsSchema),
  authHandler(async (req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    await answerLeaderOffer(id, req.user.id, false);
    res.status(204).send();
  })
);

export default router;
