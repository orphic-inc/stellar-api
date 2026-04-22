import express, { Request, Response } from 'express';
import { SubscriptionPage } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';

const router = express.Router();

// POST /api/subscriptions/subscribe
router.post(
  '/subscribe',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { topicId, action } = req.body as { topicId: number; action: 'subscribe' | 'unsubscribe' };
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
    } else {
      res.status(400).json({ msg: 'Invalid action' });
    }
  })
);

// GET /api/subscriptions
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const subscriptions = await prisma.subscription.findMany({ where: { userId } });
    res.json(subscriptions);
  })
);

// POST /api/subscriptions/subscribe-comments
router.post(
  '/subscribe-comments',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { page, pageId, action } = req.body as {
      page: SubscriptionPage; pageId: number;
      action: 'subscribe' | 'unsubscribe';
    };
    const userId = req.user!.id;

    if (action === 'subscribe') {
      await prisma.commentSubscription.upsert({
        where: { userId_page_pageId: { userId, page, pageId } },
        create: { userId, page, pageId },
        update: {}
      });
      res.status(201).json({ msg: 'Subscribed to comments successfully' });
    } else if (action === 'unsubscribe') {
      await prisma.commentSubscription.deleteMany({ where: { userId, page, pageId } });
      res.json({ msg: 'Unsubscribed from comments successfully' });
    } else {
      res.status(400).json({ msg: 'Invalid action' });
    }
  })
);

export default router;
