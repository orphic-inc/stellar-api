import express, { Request, Response } from 'express';
import { check, validationResult } from 'express-validator';
import { prisma } from '../../../../lib/prisma';
import { asyncHandler } from '../../../../modules/asyncHandler';
import { requireAuth } from '../../../../middleware/auth';

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
  [
    check('forumTopicId', 'Topic id is required').isInt(),
    check('forumPostId', 'Post id is required').isInt()
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { forumTopicId, forumPostId } = req.body as { forumTopicId: number; forumPostId: number };
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
