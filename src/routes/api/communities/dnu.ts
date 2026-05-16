import express from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { authHandler } from '../../../modules/asyncHandler';
import { requirePermission } from '../../../middleware/permissions';
import {
  validate,
  validateParams,
  parsedBody,
  parsedParams
} from '../../../middleware/validate';
import { dnuSchema, type DnuInput } from '../../../schemas/user';

const router = express.Router({ mergeParams: true });

const communityIdParams = z.object({
  communityId: z.coerce.number().int().positive()
});

const dnuIdParams = z.object({
  communityId: z.coerce.number().int().positive(),
  dnuId: z.coerce.number().int().positive()
});

// GET /api/communities/:communityId/dnu
router.get(
  '/',
  ...requirePermission('communities_manage'),
  validateParams(communityIdParams),
  authHandler(async (_req, res) => {
    const { communityId } = parsedParams<{ communityId: number }>(res);
    const entries = await prisma.doNotUpload.findMany({
      where: { communityId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(entries);
  })
);

// POST /api/communities/:communityId/dnu
router.post(
  '/',
  ...requirePermission('communities_manage'),
  validateParams(communityIdParams),
  validate(dnuSchema),
  authHandler(async (req, res) => {
    const { communityId } = parsedParams<{ communityId: number }>(res);
    const { name, comment } = parsedBody<DnuInput>(res);

    const community = await prisma.community.findUnique({
      where: { id: communityId }
    });
    if (!community) return res.status(404).json({ msg: 'Community not found' });

    const entry = await prisma.doNotUpload.create({
      data: { communityId, name, comment, userId: req.user.id }
    });
    res.status(201).json(entry);
  })
);

// DELETE /api/communities/:communityId/dnu/:dnuId
router.delete(
  '/:dnuId',
  ...requirePermission('communities_manage'),
  validateParams(dnuIdParams),
  authHandler(async (_req, res) => {
    const { communityId, dnuId } = parsedParams<{
      communityId: number;
      dnuId: number;
    }>(res);

    const entry = await prisma.doNotUpload.findFirst({
      where: { id: dnuId, communityId }
    });
    if (!entry) return res.status(404).json({ msg: 'DNU entry not found' });

    await prisma.doNotUpload.delete({ where: { id: dnuId } });
    res.status(204).send();
  })
);

export default router;
