import express from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { authHandler } from '../../../modules/asyncHandler';
import { requireAuth } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/permissions';
import { assertCommunityAccess } from '../../../modules/communityAccess';
import {
  validate,
  validateParams,
  parsedBody,
  parsedParams
} from '../../../middleware/validate';
import { dncSchema, type DncInput } from '../../../schemas/user';

const router = express.Router({ mergeParams: true });

const communityIdParams = z.object({
  communityId: z.coerce.number().int().positive()
});

const dncIdParams = z.object({
  communityId: z.coerce.number().int().positive(),
  dncId: z.coerce.number().int().positive()
});

// GET /api/communities/:communityId/dnc — readable by members of the community
//
// The list is deliberately member-facing, not staff-only: stellar-ui renders it
// in ContributeForm as the "must not be contributed" warning, so a contributor
// has to be able to read it. What it was NOT meant to be is readable across
// communities — any authenticated member could enumerate any community's list,
// including the free-text `comment` staff write about why something is banned
// (#509 F5). The handler took `_req`, which is the tell: the caller's identity
// was never consulted.
//
// Scoped with `assertCommunityAccess` — the same `open || roleUnion` rule the
// browse paths use — so this agrees with `GET /communities`, which already
// filters its list by exactly that union. The UI's community picker is fed by
// that list, so a member can only ever select a community they pass here, and
// the warning banner is unaffected.
router.get(
  '/',
  requireAuth,
  validateParams(communityIdParams),
  authHandler(async (req, res) => {
    const { communityId } = parsedParams<{ communityId: number }>(res);
    await assertCommunityAccess(communityId, req.user.id);
    const entries = await prisma.doNotContribute.findMany({
      where: { communityId },
      orderBy: { createdAt: 'desc' }
    });
    const userIds = [...new Set(entries.map((e) => e.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true }
    });
    const userMap = new Map(users.map((u) => [u.id, u]));
    const result = entries.map((e) => ({
      ...e,
      addedBy: userMap.get(e.userId) ?? null
    }));
    res.json(result);
  })
);

// POST /api/communities/:communityId/dnc
router.post(
  '/',
  ...requirePermission('dnc_manage'),
  validateParams(communityIdParams),
  validate(dncSchema),
  authHandler(async (req, res) => {
    const { communityId } = parsedParams<{ communityId: number }>(res);
    const { name, comment } = parsedBody<DncInput>(res);

    const community = await prisma.community.findUnique({
      where: { id: communityId }
    });
    if (!community) return res.status(404).json({ msg: 'Community not found' });

    const entry = await prisma.doNotContribute.create({
      data: { communityId, name, comment, userId: req.user.id }
    });
    res.status(201).json(entry);
  })
);

// DELETE /api/communities/:communityId/dnc/:dncId
router.delete(
  '/:dncId',
  ...requirePermission('dnc_manage'),
  validateParams(dncIdParams),
  authHandler(async (_req, res) => {
    const { communityId, dncId } = parsedParams<{
      communityId: number;
      dncId: number;
    }>(res);

    const entry = await prisma.doNotContribute.findFirst({
      where: { id: dncId, communityId }
    });
    if (!entry) return res.status(404).json({ msg: 'DNC entry not found' });

    await prisma.doNotContribute.delete({ where: { id: dncId } });
    res.status(204).send();
  })
);

export default router;
