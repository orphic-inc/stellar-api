import express from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/permissions';
import {
  validate,
  validateParams,
  parsedBody,
  parsedParams
} from '../../middleware/validate';
import { siteHistorySchema, type SiteHistoryInput } from '../../schemas/user';

const router = express.Router();

const siteHistoryIdParams = z.object({
  id: z.coerce.number().int().positive()
});

// GET /api/site-history
router.get(
  '/',
  requireAuth,
  authHandler(async (_req, res) => {
    const entries = await prisma.siteHistory.findMany({
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { id: true, username: true } } }
    });
    res.json(entries);
  })
);

// POST /api/site-history
router.post(
  '/',
  ...requirePermission('site_history_manage'),
  validate(siteHistorySchema),
  authHandler(async (req, res) => {
    const { title, body } = parsedBody<SiteHistoryInput>(res);
    const entry = await prisma.siteHistory.create({
      data: { authorId: req.user.id, title, body }
    });
    res.status(201).json(entry);
  })
);

// PUT /api/site-history/:id
router.put(
  '/:id',
  ...requirePermission('site_history_manage'),
  validateParams(siteHistoryIdParams),
  validate(siteHistorySchema),
  authHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const { title, body } = parsedBody<SiteHistoryInput>(res);
    const existing = await prisma.siteHistory.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ msg: 'Entry not found' });
    const entry = await prisma.siteHistory.update({
      where: { id },
      data: { title, body }
    });
    res.json(entry);
  })
);

// DELETE /api/site-history/:id
router.delete(
  '/:id',
  ...requirePermission('site_history_manage'),
  validateParams(siteHistoryIdParams),
  authHandler(async (_req, res) => {
    const { id } = parsedParams<{ id: number }>(res);
    const existing = await prisma.siteHistory.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ msg: 'Entry not found' });
    await prisma.siteHistory.delete({ where: { id } });
    res.status(204).send();
  })
);

export default router;
