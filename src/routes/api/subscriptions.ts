import express from 'express';
import { z } from 'zod';
import { SubscriptionPage } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { authHandler } from '../../modules/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { validate, parsedBody, validateQuery } from '../../middleware/validate';
import {
  subscribeSchema,
  subscribeCommentsSchema,
  type SubscribeInput,
  type SubscribeCommentsInput
} from '../../schemas/subscription';

const commentStatusQuerySchema = z.object({
  page: z.enum(
    Object.values(SubscriptionPage) as [SubscriptionPage, ...SubscriptionPage[]]
  ),
  pageId: z.coerce.number().int().positive()
});

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

// GET /api/subscriptions/comment-status
router.get(
  '/comment-status',
  requireAuth,
  validateQuery(commentStatusQuerySchema),
  authHandler(async (req, res) => {
    const { page, pageId } = res.locals.parsedQuery as {
      page: SubscriptionPage;
      pageId: number;
    };
    const sub = await prisma.commentSubscription.findUnique({
      where: { userId_page_pageId: { userId: req.user.id, page, pageId } }
    });
    res.json({ subscribed: !!sub });
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
