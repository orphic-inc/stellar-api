import express, { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  subscribeSchema,
  subscribeCommentsSchema,
  type SubscribeInput,
  type SubscribeCommentsInput
} from '../../schemas/subscription';

const router = express.Router();

// POST /api/subscriptions/subscribe
router.post(
  '/subscribe',
  requireAuth,
  validate(subscribeSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { topicId, action } = req.body as SubscribeInput;
    const userId = req.user!.id;

    if (action === 'subscribe') {
      await prisma.subscription.upsert({
        where: { userId_topicId: { userId, topicId } },
        create: { userId, topicId },
        update: {}
      });
      res.status(201).json({ msg: 'Subscribed successfully' });
    } else if (action === 'unsubscribe') {
      await prisma.subscription.deleteMany({ where: { userId, topicId } });
      res.json({ msg: 'Unsubscribed successfully' });
    }
  })
);

// GET /api/subscriptions
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const subscriptions = await prisma.subscription.findMany({
      where: { userId },
      take: 100
    });
    res.json(subscriptions);
  })
);

// POST /api/subscriptions/subscribe-comments
router.post(
  '/subscribe-comments',
  requireAuth,
  validate(subscribeCommentsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { page, pageId, action } = req.body as SubscribeCommentsInput;
    const userId = req.user!.id;

    if (action === 'subscribe') {
      await prisma.commentSubscription.upsert({
        where: { userId_page_pageId: { userId, page, pageId } },
        create: { userId, page, pageId },
        update: {}
      });
      res.status(201).json({ msg: 'Subscribed to comments successfully' });
    } else if (action === 'unsubscribe') {
      await prisma.commentSubscription.deleteMany({
        where: { userId, page, pageId }
      });
      res.json({ msg: 'Unsubscribed from comments successfully' });
    }
  })
);

export default router;
