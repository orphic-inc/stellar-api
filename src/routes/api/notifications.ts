import express, { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { validateParams, parsedParams } from '../../middleware/validate';

const router = express.Router();
const notificationIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

// GET /api/notifications
router.get(
  '/',
  requireAuth,
  authHandler(async (req, res) => {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        quoter: { select: { id: true, username: true, avatar: true } }
      }
    });
    res.json(notifications);
  })
);

// DELETE /api/notifications/:id
router.delete(
  '/:id',
  requireAuth,
  validateParams(notificationIdParamsSchema),
  authHandler(async (req, res) => {
    const { id } = res.locals.parsedParams as { id: number };
    const notif = await prisma.notification.findUnique({ where: { id } });
    if (!notif) return res.status(404).json({ msg: 'Notification not found' });
    if (notif.userId !== req.user.id)
      return res.status(403).json({ msg: 'Not authorized' });
    await prisma.notification.delete({ where: { id } });
    res.status(204).send();
  })
);

export default router;
