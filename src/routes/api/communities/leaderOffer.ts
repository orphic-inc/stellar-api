import express from 'express';
import { z } from 'zod';
import { authHandler } from '../../../modules/asyncHandler';
import {
  answerLeaderOffer,
  offerLeadership,
  withdrawLeaderOffer
} from '../../../modules/communityLeadership';
import { requireAuth } from '../../../middleware/auth';
import { validate, validateParams } from '../../../middleware/validate';
import { leaderOfferSchema } from '../../../schemas/community';

/**
 * A community leader's handoff offer, mounted at
 * `/api/communities/:id/leader-offer` (#896, ADR-0053 §3–8). Each route is a
 * relationship edit whose outcome the request decides, so each answers `204`
 * (#711); the rules live in modules/communityLeadership.ts.
 */
const router = express.Router({ mergeParams: true });
const leaderOfferBody = validate(leaderOfferSchema);
const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const idParams = validateParams(idParamsSchema);

// POST /api/communities/:id/leader-offer — the leader offers leadership to a curator
router.post(
  '/',
  requireAuth,
  idParams,
  leaderOfferBody,
  authHandler(async (req, res) => {
    const { id } = idParams.read(res);
    const { userId } = leaderOfferBody.read(res);
    await offerLeadership(id, req.user.id, userId);
    res.status(204).send();
  })
);

// DELETE /api/communities/:id/leader-offer — the leader withdraws the offer
router.delete(
  '/',
  requireAuth,
  idParams,
  authHandler(async (req, res) => {
    const { id } = idParams.read(res);
    await withdrawLeaderOffer(id, req.user.id);
    res.status(204).send();
  })
);

// POST /api/communities/:id/leader-offer/accept — the successor takes leadership
router.post(
  '/accept',
  requireAuth,
  idParams,
  authHandler(async (req, res) => {
    const { id } = idParams.read(res);
    await answerLeaderOffer(id, req.user.id, true);
    res.status(204).send();
  })
);

// POST /api/communities/:id/leader-offer/decline — the successor declines
router.post(
  '/decline',
  requireAuth,
  idParams,
  authHandler(async (req, res) => {
    const { id } = idParams.read(res);
    await answerLeaderOffer(id, req.user.id, false);
    res.status(204).send();
  })
);

export default router;
