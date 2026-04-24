import express, { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { validate, parsedBody } from '../../middleware/validate';
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
  authHandler(async (req, res) => {
    const { topicId, action } = parsedBody<SubscribeInput>(res);
    const userId = req.user.id;

    if (action === 'subscribe') {
      await prisma.subscription.upsert({
        where: { userId_topicId: { userId, topicId } },
        create: { userId, topicId },
        update: {}
      });
      res.status(204).send();
    } else if (action === 'unsubscribe') {
      await prisma.subscription.deleteMany({ where: { userId, topicId } });
      res.status(204).send();
    }
  })
);

// GET /api/subscriptions
router.get(
  '/',
  requireAuth,
  authHandler(async (req, res) => {
    const userId = req.user.id;
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
  authHandler(async (req, res) => {
    const { page, pageId, action } = parsedBody<SubscribeCommentsInput>(res);
    const userId = req.user.id;

    if (action === 'subscribe') {
      await prisma.commentSubscription.upsert({
        where: { userId_page_pageId: { userId, page, pageId } },
        create: { userId, page, pageId },
        update: {}
      });
      res.status(204).send();
    } else if (action === 'unsubscribe') {
      await prisma.commentSubscription.deleteMany({
        where: { userId, page, pageId }
      });
      res.status(204).send();
    }
  })
);

export default router;
