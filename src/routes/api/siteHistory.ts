import express from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { translatePrismaError } from '../../lib/prismaErrors';
import { authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/permissions';
import { validate, validateParams } from '../../middleware/validate';
import { siteHistorySchema } from '../../schemas/user';

const router = express.Router();
const siteHistoryBody = validate(siteHistorySchema);

const siteHistoryIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});
const siteHistoryIdParams = validateParams(siteHistoryIdParamsSchema);

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
  siteHistoryBody,
  authHandler(async (req, res) => {
    const { title, body } = siteHistoryBody.read(res);
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
  siteHistoryIdParams,
  siteHistoryBody,
  authHandler(async (_req, res) => {
    const { id } = siteHistoryIdParams.read(res);
    const { title, body } = siteHistoryBody.read(res);
    const existing = await prisma.siteHistory.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ msg: 'Entry not found' });
    let entry;
    try {
      entry = await prisma.siteHistory.update({
        where: { id },
        data: { title, body }
      });
    } catch (err) {
      translatePrismaError(err, { P2025: [404, 'Entry not found'] });
    }
    res.json(entry);
  })
);

// DELETE /api/site-history/:id
router.delete(
  '/:id',
  ...requirePermission('site_history_manage'),
  siteHistoryIdParams,
  authHandler(async (_req, res) => {
    const { id } = siteHistoryIdParams.read(res);
    const existing = await prisma.siteHistory.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ msg: 'Entry not found' });
    try {
      await prisma.siteHistory.delete({ where: { id } });
    } catch (err) {
      translatePrismaError(err, { P2025: [404, 'Entry not found'] });
    }
    res.status(204).send();
  })
);

export default router;
