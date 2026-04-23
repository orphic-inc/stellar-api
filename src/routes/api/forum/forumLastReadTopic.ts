import express, { Request, Response } from 'express';
import { prisma } from '../../../lib/prisma';
import { asyncHandler } from '../../../modules/asyncHandler';
import { requireAuth } from '../../../middleware/auth';
import { validate } from '../../../middleware/validate';
import { lastReadSchema } from '../../../schemas/forum';

const router = express.Router();

// GET /api/forums/last-read — get all last-read markers for current user
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const records = await prisma.forumLastReadTopic.findMany({
      where: { userId: req.user!.id }
    });
    res.json(records);
  })
);

// POST /api/forums/last-read — upsert a last-read marker
router.post(
  '/',
  requireAuth,
  validate(lastReadSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { forumTopicId, forumPostId } = req.body as {
      forumTopicId: number; forumPostId: number;
    };
    const userId = req.user!.id;

    const record = await prisma.forumLastReadTopic.upsert({
      where: { userId_forumTopicId: { userId, forumTopicId } },
      create: { userId, forumTopicId, forumPostId },
      update: { forumPostId }
    });
    res.json(record);
  })
);

export default router;
